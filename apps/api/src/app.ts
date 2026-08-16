import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { loadConfig, type Config } from "./config.js";
import { createDb, runMigrations, type DbHandle } from "./db/index.js";
import { migrationsDir, webDistPath } from "./paths.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildAppOptions {
  config?: Config;
  db?: DbHandle;
  scheduleMigrations?: boolean;
  serveWeb?: boolean;
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
