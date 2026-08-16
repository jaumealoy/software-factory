import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { migrationsDir } from "../../src/paths.js";
import { createTestProject } from "../helpers.js";
import type { WorkflowProvider } from "../../src/workflow/types.js";

const tmpRoots: string[] = [];
const apps: FastifyInstance[] = [];
const handles: DbHandle[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function openspecAvailable(): boolean {
  try {
    execFileSync("openspec", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeFixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `api-fixture-`));
  tmpRoots.push(root);
  mkdirSync(path.join(root, "openspec"), { recursive: true });
  writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export {};");
  return root;
}

function makeProvider(ambiguous = false): WorkflowProvider {
  return {
    async refine(input) {
      return {
        title: input.requestText.split(/[.!?\n]/)[0] ?? "Untitled",
        summary: input.requestText,
        proposedCapabilities: [{ name: "core", description: "Requested capability" }],
        ambiguities: ambiguous ? ["Provider choice unclear"] : [],
        risks: [],
        expandedScope: false,
      };
    },
    async critique(input) {
      const findings = input.refinement.ambiguities.length > 0 ? ["Resolve first."] : [];
      return { findings, recommendation: "ok", requiresHumanDecision: findings.length > 0 };
    },
    async analyze() {
      return { signals: ["capability"], notes: [] };
    },
    async plan() {
      return {
        capabilities: [
          {
            name: "core",
            description: "Requested capability",
            tasks: [
              { objective: "Define core contract", risk: "medium" },
              { objective: "Implement core", risk: "high" },
              { objective: "Verify core", risk: "low" },
            ],
          },
        ],
        dependencies: [
          { from: { capability: 0, task: 1 }, to: { capability: 0, task: 0 } },
          { from: { capability: 0, task: 2 }, to: { capability: 0, task: 1 } },
        ],
      };
    },
  };
}

const testConfig: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

async function makeServer(
  provider?: WorkflowProvider,
): Promise<{ app: FastifyInstance; store: FactoryStore }> {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const store = new FactoryStore(db.db);
  const app = await buildApp({
    db,
    config: testConfig,
    scheduleMigrations: false,
    serveWeb: false,
    workflowProvider: provider,
  });
  apps.push(app);
  return { app, store };
}

const withCli = openspecAvailable() ? describe : describe.skip;

withCli("dashboard API routes", () => {
  it("lists projects and creates a change end to end", async () => {
    const { app, store } = await makeServer();
    const { projectId } = await createTestProject(store);
    const repositoryPath = makeFixtureRepo();

    const projects = await app.inject({ method: "GET", url: "/api/projects" });
    expect(projects.statusCode).toBe(200);
    expect(projects.json().length).toBeGreaterThan(0);

    const created = await app.inject({
      method: "POST",
      url: "/api/changes",
      payload: {
        projectId,
        title: "Add tracing",
        requestText: "Add tracing to the worker.",
        repositoryPath,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.workflow.phase).toBe("completed");
    expect(createdBody.workflow.tasksCreated).toBe(3);

    const changeId = createdBody.workflow.changeId;
    const detail = await app.inject({ method: "GET", url: `/api/changes/${changeId}` });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json();
    expect(detailBody.change.status).toBe("DECOMPOSING");
    expect(detailBody.taskGraph.tasks).toHaveLength(3);
    expect(detailBody.taskGraph.isAcyclic).toBe(true);
    expect(detailBody.pendingDecisions).toHaveLength(0);
    expect(detailBody.artifacts.length).toBeGreaterThan(0);
    expect(
      detailBody.events.some(
        (event: { eventType: string }) => event.eventType === "workflow.completed",
      ),
    ).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/changes" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  it("pauses for a decision and resumes after resolution", async () => {
    const { app, store } = await makeServer(makeProvider(true));
    const { projectId } = await createTestProject(store);
    const repositoryPath = makeFixtureRepo();

    const created = await app.inject({
      method: "POST",
      url: "/api/changes",
      payload: {
        projectId,
        title: "Add tracing",
        requestText: "Add tracing to the worker.",
        repositoryPath,
      },
    });
    expect(created.statusCode).toBe(202);
    const createdBody = created.json();
    expect(createdBody.workflow.phase).toBe("awaiting_decision");
    expect(createdBody.pendingDecisions).toHaveLength(1);
    const decisionId = createdBody.workflow.decisionId;

    const pending = await app.inject({ method: "GET", url: "/api/decisions/pending" });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().some((decision: { id: string }) => decision.id === decisionId)).toBe(
      true,
    );

    const resolved = await app.inject({
      method: "POST",
      url: `/api/decisions/${decisionId}/resolve`,
      payload: { approved: true, repositoryPath },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedBody = resolved.json();
    expect(resolvedBody.decision.status).toBe("APPROVED");
    expect(resolvedBody.workflow.phase).toBe("completed");
    expect(resolvedBody.workflow.tasksCreated).toBe(3);
  });
});
