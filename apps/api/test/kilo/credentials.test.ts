import { afterEach, describe, expect, it } from "vitest";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { migrationsDir } from "../../src/paths.js";
import { setProviderCredential } from "../../src/domain/settings.js";
import { buildKiloEnv, providerOfModel, PROVIDER_ENV_VAR } from "../../src/kilo/credentials.js";
import { KiloCliExecutor, type KiloRunOptions } from "../../src/kilo/client.js";
import { ValidationError } from "../../src/domain/errors.js";

const ENCRYPTION_KEY = "test-key-123456";
const handles: DbHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
});

function makeDb() {
  const handle = createDb(":memory:");
  runMigrations(handle.db, migrationsDir);
  handles.push(handle);
  return handle.db;
}

describe("provider model -> env mapping", () => {
  it("extracts the provider from a kilo model id and maps to an env var", () => {
    expect(providerOfModel("kilo/anthropic/claude-sonnet-4.5")).toBe("anthropic");
    expect(providerOfModel("anthropic/claude-sonnet-4.5")).toBe("anthropic");
    expect(PROVIDER_ENV_VAR.anthropic).toBe("ANTHROPIC_API_KEY");
    expect(PROVIDER_ENV_VAR.openai).toBe("OPENAI_API_KEY");
  });

  it("returns null when no encryption key is configured", () => {
    const db = makeDb();
    expect(buildKiloEnv(db, "kilo/anthropic/claude-sonnet-4.5", undefined)).toBeNull();
  });

  it("injects the stored credential for the model's provider", () => {
    const db = makeDb();
    setProviderCredential(db, "anthropic", "sk-ant-secret", ENCRYPTION_KEY);
    const env = buildKiloEnv(db, "kilo/anthropic/claude-sonnet-4.5", ENCRYPTION_KEY);
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-secret" });
  });

  it("throws a clear error when the provider has no configured credential but encryption is on", () => {
    const db = makeDb();
    expect(() => buildKiloEnv(db, "kilo/anthropic/claude-sonnet-4.5", ENCRYPTION_KEY)).toThrow(
      ValidationError,
    );
    expect(() => buildKiloEnv(db, "kilo/anthropic/claude-sonnet-4.5", ENCRYPTION_KEY)).toThrow(
      /anthropic/i,
    );
  });

  it("returns null for providers that need no injected key", () => {
    const db = makeDb();
    expect(buildKiloEnv(db, "kilo/local/model", ENCRYPTION_KEY)).toBeNull();
  });
});

describe("kilo env pass-through", () => {
  it("passes the injected env to the underlying kilo process", async () => {
    let capturedArgs: string[] = [];
    let capturedEnv: Record<string, string> | undefined;
    const executor = new KiloCliExecutor(async (args, _timeout, env) => {
      capturedArgs = args;
      capturedEnv = env;
      return { stdout: "{}", stderr: "", exitCode: 0, timedOut: false };
    });

    await executor.run({
      message: "do the thing",
      model: "anthropic/claude-sonnet-4.5",
      dir: "/tmp/work",
      env: { ANTHROPIC_API_KEY: "sk-ant-secret" },
    } satisfies KiloRunOptions);

    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("anthropic/claude-sonnet-4.5");
    expect(capturedEnv).toEqual({ ANTHROPIC_API_KEY: "sk-ant-secret" });
  });
});
