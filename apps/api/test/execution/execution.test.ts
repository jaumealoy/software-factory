import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { migrationsDir } from "../../src/paths.js";
import { runnableTasks, runTask } from "../../src/execution/orchestrator.js";
import { DeterministicRunner } from "../../src/runner/index.js";
import { WorktreeManager } from "../../src/worktree/index.js";
import type { TaskRunContext, TaskRunEvent, TaskRunner } from "../../src/runner/index.js";

let repoPath: string;
const handles: DbHandle[] = [];

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  repoPath = path.join(os.tmpdir(), `exec-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "test@example.com"], repoPath);
  runGit(["config", "user.name", "Test"], repoPath);
  writeFileSync(path.join(repoPath, "package.json"), '{"name":"fixture"}\n');
  runGit(["add", "."], repoPath);
  runGit(["commit", "-m", "initial"], repoPath);
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  rmSync(repoPath, { recursive: true, force: true });
});

async function setup(changeTitle = "Add the widget") {
  const handle = createDb(":memory:");
  runMigrations(handle.db, migrationsDir);
  handles.push(handle);
  const store = new FactoryStore(handle.db);
  const project = await store.createProject({
    name: "Acme",
    slug: `acme-${Math.random().toString(36).slice(2)}`,
  });
  const change = await store.createChange({
    projectId: project.id,
    title: changeTitle,
    requestText: "Build the widget.",
  });
  for (const stage of ["REFINING", "CRITIQUE", "SPECIFYING", "ANALYZING", "DECOMPOSING"] as const) {
    await store.transitionChange(change.id, stage);
  }
  return { db: handle.db, store, change };
}

async function addReadyTask(store: FactoryStore, changeId: string, objective: string) {
  const task = await store.createTask({ changeId, objective });
  await store.transitionTask(task.id, "READY");
  return task;
}

class PhaseRecordingRunner implements TaskRunner {
  phases: Array<TaskRunContext["phase"]> = [];
  constructor(private readonly delegate: TaskRunner) {}

  async run(context: TaskRunContext, onEvent?: (event: TaskRunEvent) => void) {
    this.phases.push(context.phase);
    return this.delegate.run(context, onEvent);
  }
}

function phaseAwareRunner(
  mode: "success" | "verification-failure" | "error" = "verification-failure",
): TaskRunner {
  return {
    async run(context: TaskRunContext, onEvent?: (event: TaskRunEvent) => void) {
      const runner = new DeterministicRunner({
        mode: context.phase === "TEST_IMPLEMENTATION" ? "success" : mode,
        testCommand: "pnpm test",
      });
      return runner.run(context, onEvent);
    },
  };
}

describe("task execution orchestrator", () => {
  it("runs tests-first, then implementation, and lands on DONE", async () => {
    const { db, store, change } = await setup();
    const task = await addReadyTask(store, change.id, "Implement the widget.");
    const recorder = new PhaseRecordingRunner(
      new DeterministicRunner({ testCommand: "pnpm test" }),
    );
    const manager = new WorktreeManager();

    const result = await runTask(db, {
      taskId: task.id,
      repositoryPath: repoPath,
      model: "kilo/anthropic/claude-haiku-4.5",
      changeName: "add-widget",
      runner: recorder,
      worktrees: manager,
    });

    expect(result.outcome).toBe("DONE");
    expect(recorder.phases).toEqual(["TEST_IMPLEMENTATION", "IMPLEMENTATION"]);
    expect((await store.getTask(task.id)).status).toBe("DONE");

    const artifacts = await store.listArtifacts({ changeId: change.id, taskId: task.id });
    expect(artifacts.some((artifact) => artifact.uri?.startsWith("run://"))).toBe(true);
  });

  it("skips tasks with unfinished dependencies in runnableTasks", async () => {
    const { db, store, change } = await setup();
    const first = await addReadyTask(store, change.id, "Contract first.");
    const second = await addReadyTask(store, change.id, "Depends on contract.");
    await store.addTaskDependency({ taskId: second.id, dependsOnTaskId: first.id });

    const runnable = runnableTasks(db, change.id);
    expect(runnable.map((task) => task.id)).toEqual([first.id]);

    for (const stage of [
      "TEST_DESIGN",
      "TEST_IMPLEMENTATION",
      "IMPLEMENTATION",
      "VERIFYING",
      "REVIEW",
      "DONE",
    ] as const) {
      await store.transitionTask(first.id, stage);
    }
    const runnableAfter = runnableTasks(db, change.id);
    expect(runnableAfter.map((task) => task.id)).toEqual([second.id]);
  });

  it("rejects running a task with unfinished dependencies", async () => {
    const { db, store, change } = await setup();
    const first = await addReadyTask(store, change.id, "Contract first.");
    const second = await addReadyTask(store, change.id, "Depends on contract.");
    await store.addTaskDependency({ taskId: second.id, dependsOnTaskId: first.id });

    await expect(
      runTask(db, { taskId: second.id, repositoryPath: repoPath, model: "m", changeName: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("escalates after repeated verification failures", async () => {
    const { db, store, change } = await setup();
    const task = await addReadyTask(store, change.id, "Implement the widget.");

    const result = await runTask(db, {
      taskId: task.id,
      repositoryPath: repoPath,
      model: "kilo/anthropic/claude-haiku-4.5",
      changeName: "add-widget",
      runner: phaseAwareRunner("verification-failure"),
      maxVerificationAttempts: 1,
    });

    expect(result.outcome).toBe("ESCALATED");
    expect(result.decisionId).toBeTruthy();
    const pending = await store.listPendingDecisions({ changeId: change.id });
    expect(pending.some((decision) => decision.id === result.decisionId)).toBe(true);
  });

  it("cleans up the worktree even on failure", async () => {
    const { db, store, change } = await setup();
    const task = await addReadyTask(store, change.id, "Implement the widget.");
    const manager = new WorktreeManager();

    const result = await runTask(db, {
      taskId: task.id,
      repositoryPath: repoPath,
      model: "m",
      changeName: "add-widget",
      runner: phaseAwareRunner("verification-failure"),
      worktrees: manager,
      maxVerificationAttempts: 1,
    });

    expect(result.outcome).toBe("ESCALATED");
    const worktreePath = path.join(
      path.dirname(repoPath),
      `${path.basename(repoPath)}-task-${task.id.slice(0, 8)}`,
    );
    expect(existsSync(worktreePath)).toBe(false);
  });
});
