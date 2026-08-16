import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { loadConfig, type Config } from "./config.js";
import { createDb, runMigrations, type DbHandle } from "./db/index.js";
import { migrationsDir, webDistPath } from "./paths.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { changesRoutes } from "./routes/changes.js";
import { decisionsRoutes } from "./routes/decisions.js";
import type { WorkflowProvider } from "./workflow/types.js";

export interface BuildAppOptions {
  config?: Config;
  db?: DbHandle;
  scheduleMigrations?: boolean;
  serveWeb?: boolean;
  workflowProvider?: WorkflowProvider;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDb(config.DATABASE_PATH);
  if (options.scheduleMigrations !== false) {
    runMigrations(db.db, migrationsDir);
  }

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  });

  await app.register(healthRoutes, { db: db.db });
  await app.register(projectRoutes, { db: db.db });
  await app.register(changesRoutes, { db: db.db, workflowProvider: options.workflowProvider });
  await app.register(decisionsRoutes, { db: db.db, workflowProvider: options.workflowProvider });

  if ((options.serveWeb ?? config.NODE_ENV !== "test") && existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
