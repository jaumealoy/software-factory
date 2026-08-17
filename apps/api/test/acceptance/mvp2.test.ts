import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { setProjectDefaultModel, setTaskModel } from "../../src/domain/models.js";
import { publishChangeIssues } from "../../src/github/publisher.js";
import type { CreateIssueInput, EditIssueInput, IssueExecutor } from "../../src/github/client.js";
import { runnableTasks, runTaskWithResolvedModel } from "../../src/execution/orchestrator.js";
import { DeterministicRunner } from "../../src/runner/index.js";
import type { TaskRunContext, TaskRunEvent, TaskRunner } from "../../src/runner/index.js";
import { migrationsDir } from "../../src/paths.js";

const handles: DbHandle[] = [];
const repoPaths: string[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const repoPath of repoPaths.splice(0)) {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const repoPath = path.join(os.tmpdir(), `m2-${Math.random().toString(36).slice(2)}`);
  repoPaths.push(repoPath);
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repoPath });
  writeFileSync(path.join(repoPath, "package.json"), '{"name":"f"}\n');
  execFileSync("git", ["add", "."], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
  return repoPath;
}

class RecordingRunner implements TaskRunner {
  modelsUsed: string[] = [];
  constructor(private readonly delegate: TaskRunner) {}

  async run(context: TaskRunContext, onEvent?: (event: TaskRunEvent) => void) {
    this.modelsUsed.push(context.model);
    return this.delegate.run(context, onEvent);
  }
}

class RecordingIssues implements IssueExecutor {
  edited: number[] = [];
  private next = 10;

  async createIssue(input: CreateIssueInput) {
    const number = this.next++;
    return { number, url: `https://github.com/${input.repoFullName}/issues/${number}` };
  }

  async editIssue(input: EditIssueInput) {
    this.edited.push(input.number);
    return {
      number: input.number,
      url: `https://github.com/${input.repoFullName}/issues/${input.number}`,
    };
  }
}

async function setupChange() {
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
    title: "Add analytics",
    requestText: "Add usage analytics.",
  });
  for (const stage of ["REFINING", "CRITIQUE", "SPECIFYING", "ANALYZING", "DECOMPOSING"] as const) {
    await store.transitionChange(change.id, stage);
  }
  return { db: handle.db, store, change };
}

describe("MVP 2 acceptance — per-task model selection to execution", () => {
  it("resolves a model for each task, executes in order through worktrees, and refreshes GitHub", async () => {
    const { db, store, change } = await setupChange();
    const repoPath = makeRepo();
    const github = new RecordingIssues();

    // Decomposed tasks with a dependency.
    const contract = await store.createTask({
      changeId: change.id,
      objective: "Define analytics contract.",
    });
    const impl = await store.createTask({ changeId: change.id, objective: "Implement analytics." });
    await store.addTaskDependency({ taskId: impl.id, dependsOnTaskId: contract.id });
    await store.transitionTask(contract.id, "READY");
    await store.transitionTask(impl.id, "READY");

    // Per-task model selection with precedence.
    setTaskModel(db, contract.id, "kilo/openai/gpt-mini-latest");
    setProjectDefaultModel(db, change.projectId, "kilo/anthropic/claude-sonnet-4.5");

    // Publish issues first so tasks carry GitHub references.
    await publishChangeIssues(db, {
      changeId: change.id,
      repoFullName: "acme/product",
      labels: ["factory"],
      executor: github,
    });

    // Execution order: runnableTasks only exposes the unblocked contract task.
    const recorder = new RecordingRunner(new DeterministicRunner({ testCommand: "pnpm test" }));

    const firstRunable = runnableTasks(db, change.id);
    expect(firstRunable.map((task) => task.id)).toEqual([contract.id]);

    const first = await runTaskWithResolvedModel(db, {
      taskId: contract.id,
      repositoryPath: repoPath,
      changeName: "add-analytics",
      runner: recorder,
      github: { repoFullName: "acme/product", executor: github },
    });
    await expect(first.outcome).toBe("DONE");
    expect(recorder.modelsUsed).toEqual([
      "kilo/openai/gpt-mini-latest",
      "kilo/openai/gpt-mini-latest",
    ]);

    // Contract now DONE unlocks the implementation task, which uses the project default.
    const secondRunable = runnableTasks(db, change.id);
    expect(secondRunable.map((task) => task.id)).toEqual([impl.id]);

    const second = await runTaskWithResolvedModel(db, {
      taskId: impl.id,
      repositoryPath: repoPath,
      changeName: "add-analytics",
      runner: recorder,
      github: { repoFullName: "acme/product", executor: github },
    });
    await expect(second.outcome).toBe("DONE");
    expect(recorder.modelsUsed.slice(2)).toEqual([
      "kilo/anthropic/claude-sonnet-4.5",
      "kilo/anthropic/claude-sonnet-4.5",
    ]);

    // GitHub issues were refreshed after successful runs.
    expect(github.edited.length).toBeGreaterThanOrEqual(2);

    // Run results are persisted and the model is recorded.
    const artifacts = await store.listArtifacts({ changeId: change.id, taskId: contract.id });
    expect(artifacts.some((artifact) => artifact.uri?.startsWith("run://"))).toBe(true);
    const events = await store.listEvents({ entityType: "task", entityId: contract.id });
    expect(events.some((event) => event.eventType === "task.execution_completed")).toBe(true);
  });

  it("escalates repeated verification failures to a human decision", async () => {
    const { db, store, change } = await setupChange();
    const repoPath = makeRepo();
    const task = await store.createTask({ changeId: change.id, objective: "Fragile feature." });
    await store.transitionTask(task.id, "READY");

    const runner = {
      async run(context: TaskRunContext) {
        const mode = context.phase === "TEST_IMPLEMENTATION" ? "success" : "verification-failure";
        return new DeterministicRunner({ mode, testCommand: "pnpm test" }).run(context);
      },
    };

    const result = await runTaskWithResolvedModel(db, {
      taskId: task.id,
      repositoryPath: repoPath,
      changeName: "add-analytics",
      runner,
      maxVerificationAttempts: 1,
    });

    expect(result.outcome).toBe("ESCALATED");
    expect(result.decisionId).toBeTruthy();
    const pending = await store.listPendingDecisions({ changeId: change.id });
    expect(pending.some((decision) => decision.id === result.decisionId)).toBe(true);
    expect(["REWORK", "VERIFYING"]).toContain((await store.getTask(task.id)).status);
  });
});
