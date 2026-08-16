import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

const testConfig: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    config: testConfig,
    serveWeb: false,
  });
  apps.push(app);
  return app;
}

describe("buildApp", () => {
  it("starts and reaches the health endpoint", async () => {
    const app = await makeApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      database: "connected",
    });
  });

  it("returns 404 for unknown API routes", async () => {
    const app = await makeApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
  });
});
