import type { Db } from "../db/index.js";
import { analyzeRepository } from "../analysis/impact.js";
import type { RepositoryOverrides } from "../analysis/discovery.js";
import { recordArtifact } from "../domain/artifacts.js";
import { addCapability } from "../domain/capabilities.js";
import { createChange, getChange, transitionChange } from "../domain/changes.js";
import { listPendingDecisions, requestDecision } from "../domain/decisions.js";
import { CyclicDependencyError, ValidationError } from "../domain/errors.js";
import { recordEvent } from "../domain/events.js";
import { addTaskDependency, createTask } from "../domain/tasks.js";
import { createOpenSpecChange } from "../openspec/adapter.js";
import { OpenSpecValidationFailedError } from "../openspec/errors.js";
import type { ChangeStatus } from "../domain/statuses.js";
import { RuleProvider } from "./ruleProvider.js";
import type { CritiqueOutput, PlanOutput, RefineOutput, WorkflowProvider } from "./types.js";

export interface RunWorkflowInput {
  projectId: string;
  title: string;
  requestText: string;
  repositoryPath: string;
  provider?: WorkflowProvider;
  openspec?: { autoInit?: boolean; sourceRevision?: string };
  overrides?: RepositoryOverrides;
}

export interface ResumeWorkflowInput {
  changeId: string;
  repositoryPath: string;
  provider?: WorkflowProvider;
  openspec?: { autoInit?: boolean; sourceRevision?: string };
  overrides?: RepositoryOverrides;
}

export type WorkflowPhase = "completed" | "awaiting_decision";

export interface WorkflowResult {
  changeId: string;
  phase: WorkflowPhase;
  decisionId: string | null;
  tasksCreated: number;
  capabilitiesCreated: number;
  openspecName: string | null;
  impactArtifactId: string | null;
}

function paused(changeId: string, decisionId: string): WorkflowResult {
  return {
    changeId,
    phase: "awaiting_decision",
    decisionId,
    tasksCreated: 0,
    capabilitiesCreated: 0,
    openspecName: null,
    impactArtifactId: null,
  };
}

/** Starts the bounded request -> task-graph workflow. */
export async function runWorkflow(db: Db, input: RunWorkflowInput): Promise<WorkflowResult> {
  const provider = input.provider ?? new RuleProvider();

  const change = createChange(db, {
    projectId: input.projectId,
    title: input.title,
    requestText: input.requestText,
  });

  transitionChange(db, change.id, "REFINING");
  const refinement = await provider.refine({ requestText: input.requestText });
  persistStage(db, change.id, "refined", refinement);
  recordEvent(db, {
    entityType: "change",
    entityId: change.id,
    eventType: "workflow.refined",
    payload: { title: refinement.title },
  });

  transitionChange(db, change.id, "CRITIQUE");
  const critique = await provider.critique({ requestText: input.requestText, refinement });
  persistStage(db, change.id, "critiqued", critique);
  recordEvent(db, {
    entityType: "change",
    entityId: change.id,
    eventType: "workflow.critiqued",
    payload: { findings: critique.findings, requiresDecision: critique.requiresHumanDecision },
  });

  if (needsHumanDecision(refinement, critique)) {
    const problem = critique.findings[0] ?? refinement.ambiguities[0] ?? "Unresolved ambiguity";
    const decision = requestDecision(db, {
      changeId: change.id,
      problem,
      options: ["Approve the refined scope", "Reopen and adjust the request"],
      recommendation: "Approve the refined scope",
      rationale: "Further specification requires a product decision.",
      resumeStatus: "SPECIFYING",
    });
    recordEvent(db, {
      entityType: "change",
      entityId: change.id,
      eventType: "workflow.awaiting_decision",
      payload: { decisionId: decision.id },
    });
    return paused(change.id, decision.id);
  }

  return executeRemainingStages(db, {
    changeId: change.id,
    repositoryPath: input.repositoryPath,
    provider,
    openspec: input.openspec,
    overrides: input.overrides,
  });
}

/** Resumes a paused workflow after its decisions have been resolved. */
export async function resumeWorkflow(db: Db, input: ResumeWorkflowInput): Promise<WorkflowResult> {
  const change = getChange(db, input.changeId);
  const pending = listPendingDecisions(db, { changeId: change.id });
  if (pending.length > 0) {
    throw new ValidationError("Workflow is still awaiting a human decision");
  }
  return executeRemainingStages(db, {
    changeId: change.id,
    repositoryPath: input.repositoryPath,
    provider: input.provider ?? new RuleProvider(),
    openspec: input.openspec,
    overrides: input.overrides,
  });
}

interface RemainingStagesInput {
  changeId: string;
  repositoryPath: string;
  provider: WorkflowProvider;
  openspec?: { autoInit?: boolean; sourceRevision?: string };
  overrides?: RepositoryOverrides;
}

async function executeRemainingStages(
  db: Db,
  input: RemainingStagesInput,
): Promise<WorkflowResult> {
  const change = getChange(db, input.changeId);

  const refinement = await input.provider.refine({ requestText: change.requestText });
  const critique = await input.provider.critique({ requestText: change.requestText, refinement });

  // Specification stage (OpenSpec artifacts).
  transitionTo(db, change.id, "SPECIFYING");
  const openspecName = kebabCase(change.title) || `change-${change.id.slice(0, 8)}`;
  const specification = await runSpecificationStage(db, change.id, openspecName, input);
  if (!specification.ok) {
    return paused(change.id, specification.decisionId);
  }

  // Impact analysis stage.
  transitionTo(db, change.id, "ANALYZING");
  const analyze = await input.provider.analyze({ requestText: change.requestText, refinement });
  let impact;
  try {
    impact = await analyzeRepository(db, {
      changeId: change.id,
      repositoryPath: input.repositoryPath,
      requestSubject: change.title,
      signals: analyze.signals,
      overrides: input.overrides,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown impact analysis error";
    const decision = requestDecision(db, {
      changeId: change.id,
      problem: `Impact analysis failed: ${message}`,
      options: ["Correct the repository configuration", "Continue without impact analysis"],
      recommendation: "Correct the repository configuration",
      resumeStatus: "ANALYZING",
    });
    recordEvent(db, {
      entityType: "change",
      entityId: change.id,
      eventType: "workflow.awaiting_decision",
      payload: { decisionId: decision.id },
    });
    return paused(change.id, decision.id);
  }
  recordEvent(db, {
    entityType: "change",
    entityId: change.id,
    eventType: "workflow.impact_analyzed",
    payload: {
      artifactId: impact.artifactId,
      confidence: impact.manifest.confidence,
      graphUnavailable: impact.manifest.graphUnavailable,
    },
  });

  // Capability / task decomposition stage.
  transitionTo(db, change.id, "DECOMPOSING");
  const plan = await input.provider.plan({
    requestText: change.requestText,
    refinement,
    critique,
    signals: analyze.signals,
    impactManifestId: impact.artifactId,
  });
  persistStage(db, change.id, "decomposed", plan);

  const planned = persistPlan(db, change.id, plan);
  if (planned.escalationType === "cycle") {
    const decision = requestDecision(db, {
      changeId: change.id,
      problem: "Task plan introduced a dependency cycle.",
      options: ["Replan tasks", "Keep the existing task graph"],
      recommendation: "Replan tasks",
      resumeStatus: "DECOMPOSING",
    });
    recordEvent(db, {
      entityType: "change",
      entityId: change.id,
      eventType: "workflow.replan_requested",
      payload: { decisionId: decision.id },
    });
    return paused(change.id, decision.id);
  }

  recordEvent(db, {
    entityType: "change",
    entityId: change.id,
    eventType: "workflow.completed",
    payload: {
      tasksCreated: planned.tasksCreated,
      capabilitiesCreated: planned.capabilitiesCreated,
      openspecName,
    },
  });

  return {
    changeId: change.id,
    phase: "completed",
    decisionId: null,
    tasksCreated: planned.tasksCreated,
    capabilitiesCreated: planned.capabilitiesCreated,
    openspecName,
    impactArtifactId: impact.artifactId,
  };
}

type SpecificationOutcome = { ok: true; name: string } | { ok: false; decisionId: string };

async function runSpecificationStage(
  db: Db,
  changeId: string,
  openspecName: string,
  input: RemainingStagesInput,
): Promise<SpecificationOutcome> {
  try {
    await createOpenSpecChange(db, {
      changeId,
      repoPath: input.repositoryPath,
      name: openspecName,
      artifacts: buildOpenSpecArtifacts(),
      autoInit: input.openspec?.autoInit,
      sourceRevision: input.openspec?.sourceRevision,
    });
    return { ok: true, name: openspecName };
  } catch (error) {
    if (error instanceof OpenSpecValidationFailedError) {
      const problems = error.issues.map((issue) => issue.message).join("; ");
      const decision = requestDecision(db, {
        changeId,
        problem: `OpenSpec validation failed for "${openspecName}": ${problems}`,
        options: ["Fix the generated artifacts", "Skip OpenSpec artifacts for this change"],
        recommendation: "Fix the generated artifacts",
        resumeStatus: "SPECIFYING",
      });
      return { ok: false, decisionId: decision.id };
    }
    throw error;
  }
}

function buildOpenSpecArtifacts() {
  return {
    proposal: {
      why: "Capability driven by the factory pipeline.",
      whatChanges: ["Run the new capability through the factory pipeline."],
      newCapabilities: [{ name: "factory-capability", description: "Requested capability" }],
      modifiedCapabilities: [],
      impact: ["apps", "packages"],
    },
    design: {
      context: ["Pipeline-generated design."],
      goals: ["Ship the capability."],
      nonGoals: ["Out-of-scope extensions."],
      decisions: ["Use the factory pipeline."],
      risks: [],
    },
    specs: [
      {
        name: "factory-capability",
        requirements: [
          {
            name: "Capability is tracked",
            text: "The system SHALL expose the requested capability once requested.",
            scenarios: [
              {
                scenario: "Capability exists",
                when: "a user requests the capability",
                then: "the factory tracks it as a task",
              },
            ],
          },
        ],
      },
    ],
    tasks: [{ group: "Implementation", items: ["Implement", "Verify"] }],
  };
}

function persistStage(db: Db, changeId: string, stage: string, output: unknown): void {
  recordArtifact(db, {
    changeId,
    kind: "other",
    uri: `workflow://changes/${changeId}/${stage}`,
    summary: `Stage output: ${stage}`,
    validationResult: JSON.stringify(output),
  });
}

interface PlanPersistenceResult {
  capabilitiesCreated: number;
  tasksCreated: number;
  escalationType: "cycle" | null;
}

function persistPlan(db: Db, changeId: string, plan: PlanOutput): PlanPersistenceResult {
  const capabilityIds: string[] = [];
  for (const capability of plan.capabilities) {
    const created = addCapability(db, {
      changeId,
      name: capability.name,
      summary: capability.description,
    });
    capabilityIds.push(created.id);
  }

  const taskIdsByRef: Record<string, string> = {};
  let tasksCreated = 0;
  plan.capabilities.forEach((capability, capabilityIndex) => {
    capability.tasks.forEach((task, taskIndex) => {
      const capabilityId = capabilityIds[capabilityIndex];
      const created = createTask(db, {
        changeId,
        capabilityId,
        objective: task.objective,
        risk: task.risk,
      });
      taskIdsByRef[`${capabilityIndex}:${taskIndex}`] = created.id;
      tasksCreated += 1;
    });
  });

  for (const dependency of plan.dependencies) {
    const fromTask = taskIdsByRef[`${dependency.from.capability}:${dependency.from.task}`];
    const toTask = taskIdsByRef[`${dependency.to.capability}:${dependency.to.task}`];
    if (!fromTask || !toTask) {
      throw new Error("Plan referenced a task index that was never created");
    }
    try {
      addTaskDependency(db, { taskId: fromTask, dependsOnTaskId: toTask });
    } catch (error) {
      if (error instanceof CyclicDependencyError) {
        return { capabilitiesCreated: capabilityIds.length, tasksCreated, escalationType: "cycle" };
      }
      throw error;
    }
  }

  return { capabilitiesCreated: capabilityIds.length, tasksCreated, escalationType: null };
}

function needsHumanDecision(refinement: RefineOutput, critique: CritiqueOutput): boolean {
  return critique.requiresHumanDecision || refinement.expandedScope;
}

function transitionTo(db: Db, changeId: string, to: ChangeStatus): void {
  const current = getChange(db, changeId).status;
  if (current !== to) {
    transitionChange(db, changeId, to);
  }
}

function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
