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
import { migrationsDir } from "../../src/paths.js";
import { DeterministicRunner } from "../../src/runner/index.js";
import { WorktreeManager } from "../../src/worktree/index.js";

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

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

function makeRepo(): string {
  const repoPath = path.join(os.tmpdir(), `tasks-${Math.random().toString(36).slice(2)}`);
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

describe("task run API", () => {
  it("runs a READY task and exposes its run history", async () => {
    const dbHandle = createDb(":memory:");
    runMigrations(dbHandle.db, migrationsDir);
    handles.push(dbHandle);
    const store = new FactoryStore(dbHandle.db);
    const app = await buildApp({
      db: dbHandle,
      config,
      scheduleMigrations: false,
      serveWeb: false,
      taskRunner: new DeterministicRunner({ testCommand: "pnpm test" }),
      worktrees: new WorktreeManager(),
    });
    apps.push(app);

    const project = await store.createProject({
      name: "P",
      slug: `p-${Math.random().toString(36).slice(2)}`,
    });
    const change = await store.createChange({
      projectId: project.id,
      title: "Add",
      requestText: "x",
    });
    const task = await store.createTask({ changeId: change.id, objective: "Implement." });
    await store.transitionTask(task.id, "READY");
    const repoPath = makeRepo();

    const run = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/run`,
      payload: { repositoryPath: repoPath },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().result.outcome).toBe("DONE");
    expect((await store.getTask(task.id)).status).toBe("DONE");

    const runs = await app.inject({ method: "GET", url: `/api/tasks/${task.id}/runs` });
    expect(runs.statusCode).toBe(200);
    expect(runs.json().runs.length).toBeGreaterThan(0);

    // A non-READY task is rejected
    const other = await store.createTask({ changeId: change.id, objective: "Not ready." });
    const bad = await app.inject({
      method: "POST",
      url: `/api/tasks/${other.id}/run`,
      payload: { repositoryPath: repoPath },
    });
    expect(bad.statusCode).toBe(422);
  });
});
