import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { migrationsDir } from "../../src/paths.js";

const ENCRYPTION_KEY = "test-encryption-key-123456";

const apps: FastifyInstance[] = [];
const handles: DbHandle[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
});

function makeConfig(encryptionKey?: string): Config {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 0,
    DATABASE_PATH: ":memory:",
    LOG_LEVEL: "silent",
    FACTORY_ENCRYPTION_KEY: encryptionKey,
  };
}

async function makeServer(encryptionKey?: string): Promise<FastifyInstance> {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const app = await buildApp({
    db,
    config: makeConfig(encryptionKey),
    scheduleMigrations: false,
    serveWeb: false,
  });
  apps.push(app);
  return app;
}

describe("encrypted provider credential storage (#28)", () => {
  it("round-trips a secret and never returns it in plaintext", async () => {
    const app = await makeServer(ENCRYPTION_KEY);

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings/providers/anthropic",
      payload: { key: "sk-ant-test-secret-0001" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      provider: "anthropic",
      configured: true,
      masked: "••••0001",
    });

    const list = await app.inject({ method: "GET", url: "/api/settings/providers" });
    expect(list.statusCode).toBe(200);
    const providers = list.json().providers as Array<{
      provider: string;
      configured: boolean;
      masked: string | null;
    }>;
    const anthropic = providers.find((p) => p.provider === "anthropic");
    expect(anthropic?.configured).toBe(true);
    expect(anthropic?.masked).toBe("••••0001");
    expect(JSON.stringify(list.json())).not.toContain("sk-ant-test-secret-0001");
  });

  it("stores ciphertext, not the raw secret", async () => {
    const db = createDb(":memory:");
    runMigrations(db.db, migrationsDir);
    handles.push(db);
    const app = await buildApp({
      db,
      config: makeConfig(ENCRYPTION_KEY),
      scheduleMigrations: false,
      serveWeb: false,
    });
    apps.push(app);

    await app.inject({
      method: "PUT",
      url: "/api/settings/providers/openai",
      payload: { key: "sk-openai-abcdef" },
    });

    const rows = db.client.prepare("SELECT * FROM factory_meta").all() as Array<{
      key: string;
      value: string;
    }>;
    const credential = rows.find((r) => r.value.includes("sk-openai"));
    expect(credential).toBeUndefined();
    const stored = rows.find((r) => r.key === "credential:openai");
    expect(stored).toBeDefined();
    expect(stored!.value).not.toContain("sk-openai-abcdef");
    expect(stored!.value.startsWith('{"v":1,"iv":')).toBe(true);
  });

  it("fails closed when no encryption key is configured", async () => {
    const app = await makeServer(undefined);

    const put = await app.inject({
      method: "PUT",
      url: "/api/settings/providers/openai",
      payload: { key: "sk-test" },
    });
    expect(put.statusCode).toBe(503);

    const list = await app.inject({ method: "GET", url: "/api/settings/providers" });
    expect(list.statusCode).toBe(503);
  });

  it("rejects an unsupported provider", async () => {
    const app = await makeServer(ENCRYPTION_KEY);
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/providers/neverbefore",
      payload: { key: "sk-test" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("supports configuring an OpenRouter credential", async () => {
    const app = await makeServer(ENCRYPTION_KEY);
    const put = await app.inject({
      method: "PUT",
      url: "/api/settings/providers/openrouter",
      payload: { key: "sk-or-1234" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      provider: "openrouter",
      configured: true,
      masked: "••••1234",
    });
  });

  it("removes a credential", async () => {
    const app = await makeServer(ENCRYPTION_KEY);
    await app.inject({
      method: "PUT",
      url: "/api/settings/providers/google",
      payload: { key: "gsk-xyz" },
    });
    const del = await app.inject({ method: "DELETE", url: "/api/settings/providers/google" });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/settings/providers" });
    const google = (list.json().providers as Array<{ provider: string; configured: boolean }>).find(
      (p) => p.provider === "google",
    );
    expect(google?.configured).toBe(false);
  });
});

describe("global model favorites (#30)", () => {
  it("adds, lists, and removes favorites", async () => {
    const app = await makeServer(ENCRYPTION_KEY);

    const put = await app.inject({
      method: "PUT",
      url: "/api/favorites",
      payload: { model: "kilo/anthropic/claude-sonnet-4.5" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().models).toContain("kilo/anthropic/claude-sonnet-4.5");

    const list = await app.inject({ method: "GET", url: "/api/favorites" });
    expect(list.json().models).toContain("kilo/anthropic/claude-sonnet-4.5");

    const del = await app.inject({
      method: "DELETE",
      url: "/api/favorites",
      payload: { model: "kilo/anthropic/claude-sonnet-4.5" },
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/favorites" });
    expect(after.json().models).not.toContain("kilo/anthropic/claude-sonnet-4.5");
  });

  it("is idempotent when adding a duplicate", async () => {
    const app = await makeServer(ENCRYPTION_KEY);
    const opts = {
      method: "PUT",
      url: "/api/favorites",
      payload: { model: "kilo/anthropic/claude-haiku-4.5" },
    } as const;
    await app.inject(opts);
    const second = await app.inject(opts);
    expect(second.statusCode).toBe(200);
    expect(
      second.json().models.filter((m: string) => m === "kilo/anthropic/claude-haiku-4.5"),
    ).toHaveLength(1);
  });
});
