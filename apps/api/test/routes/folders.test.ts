import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { migrationsDir } from "../../src/paths.js";

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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `folder-fixture-`));
  tmpRoots.push(root);
  return root;
}

async function makeServer() {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const store = new FactoryStore(db.db);
  const project = await store.createProject({
    name: "Acme",
    slug: `acme-${Math.random().toString(36).slice(2)}`,
  });
  const app = await buildApp({
    db,
    config,
    scheduleMigrations: false,
    serveWeb: false,
  });
  apps.push(app);
  return { app, store, projectId: project.id };
}

describe("project work folders (#38)", () => {
  it("adds, lists, and marks a folder active", async () => {
    const { app, projectId } = await makeServer();
    const dir = makeDir();

    const added = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: { name: "Backend", path: dir },
    });
    expect(added.statusCode).toBe(201);
    const folderId = added.json().folder.id as string;

    const list = await app.inject({ method: "GET", url: `/api/projects/${projectId}/folders` });
    const folders = list.json().folders as Array<{
      id: string;
      name: string;
      isPrimary: boolean;
      exists: boolean;
    }>;
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      id: folderId,
      name: "Backend",
      isPrimary: true,
      exists: true,
    });

    const second = makeDir();
    const added2 = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: { name: "Web", path: second },
    });
    const secondId = added2.json().folder.id as string;

    const activated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/folders/${secondId}`,
    });
    const after = activated.json().folders as Array<{ id: string; isPrimary: boolean }>;
    expect(after.find((f) => f.id === secondId)?.isPrimary).toBe(true);
    expect(after.find((f) => f.id === folderId)?.isPrimary).toBe(false);
  });

  it("removes a folder and promotes another to primary", async () => {
    const { app, projectId } = await makeServer();
    const a = makeDir();
    const b = makeDir();
    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: { name: "A", path: a },
    });
    const firstId = first.json().folder.id as string;
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: { name: "B", path: b },
    });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/folders/${firstId}`,
    });
    const remaining = removed.json().folders as Array<{ name: string; isPrimary: boolean }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: "B", isPrimary: true });
  });

  it("flags missing folder paths without failing", async () => {
    const { app, projectId } = await makeServer();
    const missing = path.join(os.tmpdir(), "does-not-exist-12345");
    const added = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: { name: "Missing", path: missing },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().folder.exists).toBe(false);
  });

  it("rejects a duplicate folder path and unknown folders", async () => {
    const { app, projectId } = await makeServer();
    const dir = makeDir();
    const body = { name: "Dup", path: dir };
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/folders`, payload: body });
    const dup = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/folders`,
      payload: body,
    });
    expect(dup.statusCode).toBe(422);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/folders/nope`,
    });
    expect(patch.statusCode).toBe(404);
  });
});
