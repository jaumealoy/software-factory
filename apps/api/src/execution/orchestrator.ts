import type { Db } from "../db/index.js";
import type { Task } from "../db/index.js";
import { getChange } from "../domain/changes.js";
import { requestDecision } from "../domain/decisions.js";
import { ValidationError } from "../domain/errors.js";
import { recordEvent } from "../domain/events.js";
import { getTask, getTaskGraph, transitionTask } from "../domain/tasks.js";
import { resolveTaskModel } from "../domain/models.js";
import type { ChangeStatus } from "../domain/statuses.js";
import { listArtifacts } from "../domain/artifacts.js";
import { publishTaskIssue } from "../github/publisher.js";
import type { IssueExecutor } from "../github/client.js";
import { KiloRunner } from "../kilo/runner.js";
import {
  persistRun,
  type TaskRunContext,
  type TaskRunResult,
  type TaskRunner,
} from "../runner/index.js";
import { WorktreeError, WorktreeManager } from "../worktree/index.js";

export interface ExecutionOptions {
  maxVerificationAttempts?: number;
  testCommand?: string;
}

export interface RunTaskInput extends ExecutionOptions {
  taskId: string;
  repositoryPath: string;
  model: string;
  changeName?: string;
  runner?: TaskRunner;
  worktrees?: WorktreeManager;
  github?: { repoFullName: string; changeIssueNumber?: number; executor?: IssueExecutor };
}

export type RunOutcome = "DONE" | "REWORK" | "ESCALATED" | "FAILED";

export interface RunTaskResult {
  taskId: string;
  outcome: RunOutcome;
  decisionId: string | null;
  phaseResults: Array<{ phase: TaskRunContext["phase"]; result: TaskRunResult }>;
}

/** Runs a task using its resolved model (task preference > project default > global default). */
export async function runTaskWithResolvedModel(
  db: Db,
  input: Omit<RunTaskInput, "model">,
): Promise<RunTaskResult> {
  const resolution = resolveTaskModel(db, input.taskId);
  return runTask(db, { ...input, model: resolution.model });
}

/** Tasks that are READY and whose dependencies are all DONE. */
export function runnableTasks(db: Db, changeId: string): Task[] {
  const graph = getTaskGraph(db, changeId);
  const done = new Set(graph.tasks.filter((task) => task.status === "DONE").map((task) => task.id));
  return graph.tasks.filter(
    (task) =>
      task.status === "READY" &&
      graph.edges
        .filter((edge) => edge.taskId === task.id)
        .every((edge) => done.has(edge.dependsOnTaskId)),
  );
}

export async function runTask(db: Db, input: RunTaskInput): Promise<RunTaskResult> {
  const task = getTask(db, input.taskId);
  const change = getChange(db, task.changeId);

  if (task.status !== "READY") {
    throw new ValidationError(`Task must be READY to run (status ${task.status})`);
  }
  const graph = getTaskGraph(db, task.changeId);
  const blockers = graph.edges.filter((edge) => {
    if (edge.taskId !== task.id) return false;
    const dependency = graph.tasks.find((candidate) => candidate.id === edge.dependsOnTaskId);
    return dependency?.status !== "DONE";
  });
  if (blockers.length > 0) {
    throw new ValidationError("Task has unfinished dependencies");
  }

  const testCommand = input.testCommand ?? "pnpm test";
  const runner = input.runner ?? new KiloRunner({ testCommand });
  const worktrees = input.worktrees ?? new WorktreeManager();
  const maxAttempts = input.maxVerificationAttempts ?? 2;
  const changeName = input.changeName ?? (kebabCase(change.title) || "change");
  const artifactPaths = listArtifacts(db, { changeId: task.changeId })
    .map((artifact) => artifact.path)
    .filter((artifact): artifact is string => Boolean(artifact));

  const contextFor = (phase: "TEST_IMPLEMENTATION" | "IMPLEMENTATION"): TaskRunContext => ({
    changeId: task.changeId,
    taskId: task.id,
    repositoryPath: provisioned.worktreePath,
    model: input.model,
    taskObjective: task.objective,
    changeTitle: change.title,
    artifactPaths,
    testCommand,
    phase,
  });

  const onEvent = (event: TaskRunResult["events"][number]): void => {
    recordEvent(db, {
      entityType: "task",
      entityId: task.id,
      eventType: `task.run_${event.type}`,
      payload: { stage: event.stage, message: event.message },
    });
  };

  let provisioned: Awaited<ReturnType<WorktreeManager["create"]>>;
  try {
    provisioned = await worktrees.create({
      repoPath: input.repositoryPath,
      changeName,
      taskId: task.id,
    });
  } catch (error) {
    if (error instanceof WorktreeError) {
      const decision = await escalate(
        db,
        task,
        `Could not create a task worktree: ${error.message}`,
        "DECOMPOSING",
      );
      return { taskId: task.id, outcome: "ESCALATED", decisionId: decision.id, phaseResults: [] };
    }
    throw error;
  }

  const phaseResults: Array<{ phase: TaskRunContext["phase"]; result: TaskRunResult }> = [];
  try {
    // TDD phase: tests first.
    transitionTask(db, task.id, "TEST_DESIGN");
    transitionTask(db, task.id, "TEST_IMPLEMENTATION");
    const tddResult = await runner.run(contextFor("TEST_IMPLEMENTATION"), onEvent);
    phaseResults.push({ phase: "TEST_IMPLEMENTATION", result: tddResult });
    persistRun(db, {
      changeId: task.changeId,
      taskId: task.id,
      context: contextFor("TEST_IMPLEMENTATION"),
      result: tddResult,
    });

    if (tddResult.status !== "SUCCEEDED") {
      transitionTask(db, task.id, "REWORK");
      return { taskId: task.id, outcome: "REWORK", decisionId: null, phaseResults };
    }
    await worktrees.commitAll(provisioned, `tests: ${task.objective}`);

    // Implementation + verification with bounded rework.
    transitionTask(db, task.id, "IMPLEMENTATION");
    transitionTask(db, task.id, "VERIFYING");

    let last: TaskRunResult | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const implResult = await runner.run(contextFor("IMPLEMENTATION"), onEvent);
      phaseResults.push({ phase: "IMPLEMENTATION", result: implResult });
      persistRun(db, {
        changeId: task.changeId,
        taskId: task.id,
        context: contextFor("IMPLEMENTATION"),
        result: implResult,
      });

      if (implResult.status === "SUCCEEDED" && implResult.verificationPassed === true) {
        last = implResult;
        break;
      }
      last = implResult;

      transitionTask(db, task.id, "REWORK");
      transitionTask(db, task.id, "IMPLEMENTATION");
      transitionTask(db, task.id, "VERIFYING");
    }

    if (last?.status === "SUCCEEDED") {
      transitionTask(db, task.id, "REVIEW");
      transitionTask(db, task.id, "DONE");
      await worktrees.commitAll(provisioned, `implement: ${task.objective}`);

      if (input.github && task.githubIssueNumber != null) {
        await publishTaskIssue(db, {
          taskId: task.id,
          repoFullName: input.github.repoFullName,
          changeIssueNumber: input.github.changeIssueNumber,
          executor: input.github.executor,
        });
      }
      recordEvent(db, {
        entityType: "task",
        entityId: task.id,
        eventType: "task.execution_completed",
        payload: { outcome: "DONE", model: input.model },
      });
      return { taskId: task.id, outcome: "DONE", decisionId: null, phaseResults };
    }

    const decision = await escalate(
      db,
      task,
      `Task verification failed after ${maxAttempts} attempts: ${task.objective}`,
      "IMPLEMENTING",
    );
    return { taskId: task.id, outcome: "ESCALATED", decisionId: decision.id, phaseResults };
  } finally {
    await worktrees.destroy(provisioned);
  }
}

async function escalate(db: Db, task: Task, problem: string, resumeStatus: ChangeStatus) {
  const decision = requestDecision(db, {
    changeId: task.changeId,
    problem,
    options: ["Replan the task", "Restart the task", "Handle manually"],
    recommendation: "Replan the task",
    resumeStatus,
  });
  recordEvent(db, {
    entityType: "task",
    entityId: task.id,
    eventType: "task.execution_escalated",
    payload: { decisionId: decision.id },
  });
  return decision;
}

function kebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
