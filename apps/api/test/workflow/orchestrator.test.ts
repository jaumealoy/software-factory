import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkflow, resumeWorkflow } from "../../src/workflow/orchestrator.js";
import { getTaskGraph } from "../../src/domain/tasks.js";
import { createTestContext, createTestProject } from "../helpers.js";
import type {
  AnalyzeInput,
  AnalyzeOutput,
  CritiqueInput,
  CritiqueOutput,
  PlanInput,
  PlanOutput,
  RefineInput,
  RefineOutput,
  WorkflowProvider,
} from "../../src/workflow/types.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `wf-fixture-`));
  tmpRoots.push(root);
  mkdirSync(path.join(root, "openspec"), { recursive: true });
  writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export {};");
  return root;
}

function openspecAvailable(): boolean {
  try {
    execFileSync("openspec", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const withCli = openspecAvailable() ? describe : describe.skip;

class FakeProvider implements WorkflowProvider {
  ambiguities: string[] = [];
  expandedScope = false;
  cyclicPlan = false;

  async refine(input: RefineInput): Promise<RefineOutput> {
    return {
      title: input.requestText.split(/[.!?\n]/)[0] ?? "Untitled",
      summary: input.requestText,
      proposedCapabilities: [{ name: "auth", description: "Authentication capability" }],
      ambiguities: this.ambiguities,
      risks: [],
      expandedScope: this.expandedScope,
    };
  }

  async critique(input: CritiqueInput): Promise<CritiqueOutput> {
    const findings = input.refinement.ambiguities.length > 0 ? ["Resolve ambiguity first."] : [];
    return { findings, recommendation: "ok", requiresHumanDecision: findings.length > 0 };
  }

  async analyze(_input: AnalyzeInput): Promise<AnalyzeOutput> {
    return { signals: ["auth"], notes: [] };
  }

  async plan(_input: PlanInput): Promise<PlanOutput> {
    const capabilities: PlanOutput["capabilities"] = [
      {
        name: "auth",
        description: "Authentication capability",
        tasks: [
          { objective: "Define auth contract", risk: "medium" },
          { objective: "Implement provider", risk: "high" },
          { objective: "Verify auth flows", risk: "low" },
        ],
      },
    ];
    const dependencies: PlanOutput["dependencies"] = this.cyclicPlan
      ? [
          { from: { capability: 0, task: 0 }, to: { capability: 0, task: 1 } },
          { from: { capability: 0, task: 1 }, to: { capability: 0, task: 0 } },
        ]
      : [
          { from: { capability: 0, task: 1 }, to: { capability: 0, task: 0 } },
          { from: { capability: 0, task: 2 }, to: { capability: 0, task: 1 } },
        ];
    return { capabilities, dependencies };
  }
}

describe("workflow orchestration", () => {
  withCli("happy path", () => {
    it("walks the pipeline to a persisted task graph", async () => {
      const context = createTestContext();
      const { projectId } = await createTestProject(context.store);
      const repositoryPath = makeFixtureRepo();
      const provider = new FakeProvider();

      const result = await runWorkflow(context.db, {
        projectId,
        title: "Add user authentication",
        requestText: "Add user authentication to the dashboard.",
        repositoryPath,
        provider,
      });

      expect(result.phase).toBe("completed");
      expect(result.decisionId).toBeNull();
      expect(result.capabilitiesCreated).toBe(1);
      expect(result.tasksCreated).toBe(3);
      expect(result.openspecName).toBe("add-user-authentication");

      const change = await context.store.getChange(result.changeId);
      expect(change.status).toBe("DECOMPOSING");

      const graph = await context.store.getTaskGraph(result.changeId);
      expect(graph.tasks).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.isAcyclic).toBe(true);

      const artifacts = await context.store.listArtifacts({ changeId: result.changeId });
      const kinds = artifacts.map((artifact) => artifact.kind);
      expect(kinds).toContain("openspec_proposal");
      expect(kinds).toContain("openspec_spec");
      expect(kinds).toContain("impact_manifest");
      expect(kinds).toContain("other");

      const events = await context.store.listEvents({
        entityType: "change",
        entityId: result.changeId,
      });
      expect(events.some((event) => event.eventType === "workflow.completed")).toBe(true);
    });
  });

  withCli("decision gate", () => {
    it("pauses for a human decision and resumes to completion", async () => {
      const context = createTestContext();
      const { projectId } = await createTestProject(context.store);
      const repositoryPath = makeFixtureRepo();
      const provider = new FakeProvider();
      provider.ambiguities = ["Which OAuth provider should we use?"];

      const paused = await runWorkflow(context.db, {
        projectId,
        title: "Add user authentication",
        requestText: "Add user authentication to the dashboard.",
        repositoryPath,
        provider,
      });

      expect(paused.phase).toBe("awaiting_decision");
      expect(paused.decisionId).toBeTruthy();
      const changeWhilePaused = await context.store.getChange(paused.changeId);
      expect(changeWhilePaused.status).toBe("WAITING_FOR_DECISION");

      const pending = await context.store.listPendingDecisions({ changeId: paused.changeId });
      expect(pending).toHaveLength(1);

      await context.store.resolveDecision({ decisionId: paused.decisionId!, approved: true });
      provider.ambiguities = [];

      const resumed = await resumeWorkflow(context.db, {
        changeId: paused.changeId,
        repositoryPath,
        provider,
      });
      expect(resumed.phase).toBe("completed");
      expect(resumed.tasksCreated).toBe(3);
    });
  });

  withCli("edge cases", () => {
    it("escalates cyclic task plans as a decision", async () => {
      const context = createTestContext();
      const { projectId } = await createTestProject(context.store);
      const provider = new FakeProvider();
      provider.cyclicPlan = true;

      const result = await runWorkflow(context.db, {
        projectId,
        title: "Cyclic plan",
        requestText: "Add a feature to the dashboard.",
        repositoryPath: makeFixtureRepo(),
        provider,
      });

      expect(result.phase).toBe("awaiting_decision");
      expect(result.decisionId).toBeTruthy();
      const events = await context.store.listEvents({
        entityType: "change",
        entityId: result.changeId,
      });
      expect(events.some((event) => event.eventType === "workflow.replan_requested")).toBe(true);
    });

    it("records every stage output for dashboard inspection", async () => {
      const context = createTestContext();
      const { projectId } = await createTestProject(context.store);
      const provider = new FakeProvider();

      const result = await runWorkflow(context.db, {
        projectId,
        title: "Stage outputs",
        requestText: "Add tracing to the worker.",
        repositoryPath: makeFixtureRepo(),
        provider,
      });

      const stageArtifacts = (
        await context.store.listArtifacts({ changeId: result.changeId })
      ).filter((artifact) => artifact.kind === "other");
      const summaries = stageArtifacts.map((artifact) => artifact.summary);
      expect(summaries).toEqual(
        expect.arrayContaining([
          "Stage output: refined",
          "Stage output: critiqued",
          "Stage output: decomposed",
        ]),
      );
      expect(summaries).toHaveLength(3);
    });

    it("runs a full request without any external provider", async () => {
      const context = createTestContext();
      const { projectId } = await createTestProject(context.store);
      const repositoryPath = makeFixtureRepo();

      const result = await runWorkflow(context.db, {
        projectId,
        title: "Worker heartbeat",
        requestText: "Add a heartbeat to the worker.",
        repositoryPath,
      });

      expect(result.phase).toBe("completed");
      const graph = await getTaskGraph(context.db, result.changeId);
      expect(graph.tasks.length).toBeGreaterThan(0);
      expect(graph.isAcyclic).toBe(true);
      expect(result.changeId).toBeTruthy();
    });
  });
});
