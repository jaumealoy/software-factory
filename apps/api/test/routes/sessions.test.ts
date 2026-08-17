import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import type { FactoryProject } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import type { Change, Task } from "../../src/db/index.js";
import { migrationsDir } from "../../src/paths.js";
import { DeterministicRunner } from "../../src/runner/index.js";
import { SessionManager } from "../../src/session/manager.js";
import type { TaskRunContext, TaskRunEvent, TaskRunner } from "../../src/runner/index.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

const handles: DbHandle[] = [];
const apps: FastifyInstance[] = [];
const tmpRoots: string[] = [];
const managers: SessionManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.drain()));
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(): string {
  const repoPath = path.join(os.tmpdir(), `session-fixture-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "test@example.com"], repoPath);
  runGit(["config", "user.name", "Test"], repoPath);
  writeFileSync(path.join(repoPath, "package.json"), '{"name":"fixture"}\n');
  runGit(["add", "."], repoPath);
  runGit(["commit", "-m", "initial"], repoPath);
  tmpRoots.push(repoPath);
  return repoPath;
}

interface Fixture {
  app: FastifyInstance;
  task: Task;
  manager: SessionManager;
}

async function setup(
  options: { runner?: TaskRunner; maxConcurrent?: number } = {},
): Promise<Fixture> {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const store = new FactoryStore(db.db);
  const project: FactoryProject = await store.createProject({
    name: "Acme",
    slug: `acme-${Math.random().toString(36).slice(2)}`,
  });
  const change: Change = await store.createChange({
    projectId: project.id,
    title: "Add the widget",
    requestText: "Build the widget.",
  });
  for (const stage of ["REFINING", "CRITIQUE", "SPECIFYING", "ANALYZING", "DECOMPOSING"] as const) {
    await store.transitionChange(change.id, stage);
  }
  const task: Task = await store.createTask({
    changeId: change.id,
    objective: "Implement the widget.",
  });
  await store.transitionTask(task.id, "READY");

  const manager = new SessionManager(db.db, {
    runner: options.runner,
    maxConcurrent: options.maxConcurrent,
  });
  managers.push(manager);
  const app = await buildApp({
    db,
    config,
    scheduleMigrations: false,
    serveWeb: false,
    sessions: manager,
  });
  apps.push(app);
  return { app, task, manager };
}

function parseFrames(body: string): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (const block of body.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) {
      continue;
    }
    try {
      frames.push(JSON.parse(dataLine.slice(6)));
    } catch {
      // ignore keepalive/retry
    }
  }
  return frames;
}

describe("streaming execution session (#22)", () => {
  it("streams the full event sequence to completion via SSE", async () => {
    const repoPath = makeRepo();
    const { app, task } = await setup({
      runner: new DeterministicRunner({ testCommand: "pnpm test" }),
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        taskId: task.id,
        repositoryPath: repoPath,
        model: "kilo/anthropic/claude-haiku-4.5",
      },
    });
    expect(start.statusCode).toBe(201);
    const { sessionId } = start.json() as { sessionId: string };

    const stream = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/stream` });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");

    const types = parseFrames(stream.body as string).map((frame) => frame.type);
    const firstStarted = types.indexOf("started");
    for (const expected of ["tests_written", "implementation_done", "verification_passed"]) {
      expect(types.indexOf(expected)).toBeGreaterThan(firstStarted);
    }
    expect(types[types.length - 1]).toBe("session_completed");

    const status = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    expect(status.json().session.status).toBe("COMPLETED");
    expect(status.json().session.outcome).toBe("DONE");
  });

  it("replays persisted events using Last-Event-ID without duplicates", async () => {
    const repoPath = makeRepo();
    const { app, task } = await setup({
      runner: new DeterministicRunner({ testCommand: "pnpm test" }),
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { taskId: task.id, repositoryPath: repoPath },
    });
    const { sessionId } = start.json() as { sessionId: string };

    const stream = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/stream` });
    const frames = parseFrames(stream.body as string);
    expect(frames.length).toBeGreaterThan(1);
    const lastId = Number(frames[frames.length - 1]?.id);

    const resumed = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/stream`,
      headers: { "last-event-id": String(lastId) },
    });
    const resumedFrames = parseFrames(resumed.body as string);
    expect(resumedFrames.filter((frame) => Number(frame.id) <= lastId)).toHaveLength(0);
  });

  it("streams a failed event when verification fails and marks the session failed", async () => {
    const repoPath = makeRepo();
    const { app, task } = await setup({
      runner: new DeterministicRunner({ mode: "verification-failure", testCommand: "pnpm test" }),
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { taskId: task.id, repositoryPath: repoPath },
    });
    const { sessionId } = start.json() as { sessionId: string };

    const stream = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/stream` });
    const types = parseFrames(stream.body as string).map((frame) => frame.type);
    expect(types).toContain("verification_failed");
    expect(types[types.length - 1]).toBe("session_failed");

    const status = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    expect(status.json().session.status).toBe("FAILED");
  });

  it("rejects new sessions beyond the concurrency limit", async () => {
    const repoPath = makeRepo();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hangingRunner: TaskRunner = {
      async run(_context: TaskRunContext, onEvent?: (event: TaskRunEvent) => void) {
        onEvent?.({
          type: "started",
          stage: null,
          message: "started",
          timestamp: new Date().toISOString(),
        });
        await pending;
        return {
          status: "SUCCEEDED",
          events: [],
          testsCreated: [],
          changedFiles: [],
          verificationCommand: null,
          verificationOutput: null,
          verificationPassed: true,
          message: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
      },
    };
    const { app, task } = await setup({ runner: hangingRunner, maxConcurrent: 1 });

    const first = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { taskId: task.id, repositoryPath: repoPath },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { taskId: task.id, repositoryPath: repoPath },
    });
    expect(second.statusCode).toBe(429);
    release();
  });
});
