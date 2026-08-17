import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function makeRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `files-fixture-`));
  tmpRoots.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "openspec"), { recursive: true });
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{ "name": "fixture" }\n');
  writeFileSync(path.join(root, "src", "app.ts"), "export const ok = true;\n");
  writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  writeFileSync(path.join(root, "node_modules", "junk.js"), "x\n");
  return root;
}

async function makeServer(root?: string): Promise<{ app: FastifyInstance; projectId: string }> {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const store = new FactoryStore(db.db);
  const project = await store.createProject({
    name: "Acme",
    slug: `acme-${Math.random().toString(36).slice(2)}`,
  });
  if (root) {
    await store.addRepository({
      projectId: project.id,
      name: "product",
      url: "https://example.com/product",
      localPath: root,
      isPrimary: true,
    });
  }
  const app = await buildApp({
    db,
    config,
    scheduleMigrations: false,
    serveWeb: false,
    encryptionKey: "test",
  });
  apps.push(app);
  return { app, projectId: project.id };
}

describe("project file browser (#25)", () => {
  it("lists a directory tree excluding node_modules/.git/dist", async () => {
    const root = makeRepo();
    const { app, projectId } = await makeServer(root);

    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/files` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exists).toBe(true);
    const names = (body.entries as Array<{ name: string; type: string }>).map((e) => e.name);
    expect(names).toContain("package.json");
    expect(names).toContain("src");
    expect(names).toContain("openspec");
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
  });

  it("reads a file's content for preview", async () => {
    const root = makeRepo();
    const { app, projectId } = await makeServer(root);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/content?path=${encodeURIComponent("src/app.ts")}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("export const ok = true");
    expect(res.json().binary).toBe(false);
  });

  it("rejects path traversal escapes", async () => {
    const root = makeRepo();
    const { app, projectId } = await makeServer(root);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files?path=${encodeURIComponent("../../etc")}`,
    });
    expect(res.statusCode).toBe(422);

    const content = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/content?path=${encodeURIComponent("../../etc/passwd")}`,
    });
    expect(content.statusCode).toBe(422);
  });

  it("returns an empty state when no repository is configured", async () => {
    const { app, projectId } = await makeServer();
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/files` });
    expect(res.statusCode).toBe(200);
    expect(res.json().exists).toBe(false);
  });

  it("writes a file to the working tree and reads it back", async () => {
    const root = makeRepo();
    const { app, projectId } = await makeServer(root);
    const target = path.join(root, "src", "app.ts");

    const put = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files`,
      payload: { path: "src/app.ts", content: "export const edited = true;\n" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().content).toContain("export const edited = true");

    const read = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/content?path=${encodeURIComponent("src/app.ts")}`,
    });
    expect(read.json().content).toContain("export const edited = true");
    expect(readFileSync(target, "utf8")).toContain("export const edited = true");
  });

  it("rejects writing outside the repository root", async () => {
    const root = makeRepo();
    const { app, projectId } = await makeServer(root);
    const put = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/files`,
      payload: { path: "../../escape.txt", content: "x" },
    });
    expect(put.statusCode).toBe(422);
  });

  it("scopes file listing to a selected folder via folderId", async () => {
    const db = createDb(":memory:");
    runMigrations(db.db, migrationsDir);
    handles.push(db);
    const store = new FactoryStore(db.db);
    const project = await store.createProject({
      name: "Acme",
      slug: `acme-${Math.random().toString(36).slice(2)}`,
    });
    const primaryDir = makeRepo();
    const secondDir = makeRepo();
    writeFileSync(path.join(secondDir, "marker.txt"), "second folder\n");
    await store.addRepository({
      projectId: project.id,
      name: "primary",
      url: "x",
      localPath: primaryDir,
      isPrimary: true,
    });
    const second = await store.addRepository({
      projectId: project.id,
      name: "second",
      url: "x",
      localPath: secondDir,
      isPrimary: false,
    });
    const app = await buildApp({
      db,
      config,
      scheduleMigrations: false,
      serveWeb: false,
    });
    apps.push(app);

    const defaultList = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/files`,
    });
    const defaultNames = (defaultList.json().entries as Array<{ name: string }>).map((e) => e.name);
    expect(defaultNames).not.toContain("marker.txt");

    const scoped = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/files?folderId=${second.id}`,
    });
    const scopedNames = (scoped.json().entries as Array<{ name: string }>).map((e) => e.name);
    expect(scopedNames).toContain("marker.txt");

    const missing = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/files?folderId=nope`,
    });
    expect(missing.statusCode).toBe(404);
  });
});
