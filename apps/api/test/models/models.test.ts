import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { setTaskModel } from "../../src/domain/models.js";
import { migrationsDir } from "../../src/paths.js";
import { runTaskWithResolvedModel } from "../../src/execution/orchestrator.js";
import { DeterministicRunner } from "../../src/runner/index.js";
import type { TaskRunContext } from "../../src/runner/index.js";

const apps: FastifyInstance[] = [];
const handles: DbHandle[] = [];
const repoPaths: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const repoPath of repoPaths.splice(0)) {
    rmSync(repoPath, { recursive: true, force: true });
  }
});

const modelsRunner = async () =>
  "kilo/anthropic/claude-haiku-4.5\nkilo/openai/gpt-5\nkilo/anthropic/claude-sonnet-4.5\n";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

async function makeServer() {
  const handle = createDb(":memory:");
  runMigrations(handle.db, migrationsDir);
  handles.push(handle);
  const store = new FactoryStore(handle.db);
  const app = await buildApp({
    db: handle,
    config,
    scheduleMigrations: false,
    serveWeb: false,
    modelsRunner,
  });
  apps.push(app);
  return { app, store, db: handle.db };
}

function makeRepo(): string {
  const repoPath = path.join(os.tmpdir(), `models-${Math.random().toString(36).slice(2)}`);
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

describe("model config API", () => {
  it("lists models and sets per-task and project models", async () => {
    const { app, store } = await makeServer();
    const project = await store.createProject({
      name: "P",
      slug: `p-${Math.random().toString(36).slice(2)}`,
    });
    const change = await store.createChange({
      projectId: project.id,
      title: "Add",
      requestText: "x",
    });
    const task = await store.createTask({ changeId: change.id, objective: "x" });

    const list = await app.inject({ method: "GET", url: "/api/models" });
    expect(list.statusCode).toBe(200);
    expect(list.json().models.length).toBeGreaterThan(0);

    const setTask = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}/model`,
      payload: { model: "kilo/openai/gpt-5" },
    });
    expect(setTask.statusCode).toBe(200);
    expect(setTask.json().model).toMatchObject({ model: "kilo/openai/gpt-5", source: "task" });

    const getTask = await app.inject({ method: "GET", url: `/api/tasks/${task.id}` });
    expect(getTask.json().model.source).toBe("task");

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}/model`,
      payload: { model: "kilo/unknown/nope" },
    });
    expect(bad.statusCode).toBe(422);

    const setProject = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/model`,
      payload: { model: "kilo/anthropic/claude-haiku-4.5" },
    });
    expect(setProject.statusCode).toBe(200);
    expect(setProject.json().project.defaultModel).toBe("kilo/anthropic/claude-haiku-4.5");
  });
});

describe("resolved-model task execution", () => {
  it("runs a task with its per-task model", async () => {
    const { store, db } = await makeServer();
    const project = await store.createProject({
      name: "P",
      slug: `p-${Math.random().toString(36).slice(2)}`,
    });
    const change = await store.createChange({
      projectId: project.id,
      title: "Add",
      requestText: "x",
    });
    for (const stage of [
      "REFINING",
      "CRITIQUE",
      "SPECIFYING",
      "ANALYZING",
      "DECOMPOSING",
    ] as const) {
      await store.transitionChange(change.id, stage);
    }
    const task = await store.createTask({ changeId: change.id, objective: "Implement." });
    await store.transitionTask(task.id, "READY");
    setTaskModel(db, task.id, "kilo/openai/gpt-5");

    const modelsUsed: string[] = [];
    const runner = {
      async run(context: TaskRunContext) {
        modelsUsed.push(context.model);
        const base = new DeterministicRunner({ testCommand: "pnpm test" });
        return base.run(context);
      },
    };

    const repoPath = makeRepo();
    const result = await runTaskWithResolvedModel(db, {
      taskId: task.id,
      repositoryPath: repoPath,
      changeName: "add-widget",
      runner,
    });

    expect(result.outcome).toBe("DONE");
    expect(modelsUsed).toEqual(["kilo/openai/gpt-5", "kilo/openai/gpt-5"]);
  });
});
