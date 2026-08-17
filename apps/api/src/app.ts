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
import { modelsRoutes } from "./routes/models.js";
import { tasksRoutes } from "./routes/tasks.js";
import { settingsRoutes } from "./routes/settings.js";
import { favoritesRoutes } from "./routes/favorites.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { SessionManager } from "./session/manager.js";
import type { WorkflowProvider } from "./workflow/types.js";

export interface BuildAppOptions {
  config?: Config;
  db?: DbHandle;
  scheduleMigrations?: boolean;
  serveWeb?: boolean;
  workflowProvider?: WorkflowProvider;
  modelsRunner?: () => Promise<string>;
  taskRunner?: import("./runner/index.js").TaskRunner;
  worktrees?: import("./worktree/index.js").WorktreeManager;
  testCommand?: string;
  encryptionKey?: string;
  sessions?: SessionManager;
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
  await app.register(projectRoutes, { db: db.db, modelsRunner: options.modelsRunner });
  await app.register(modelsRoutes, { modelsRunner: options.modelsRunner });
  await app.register(tasksRoutes, {
    db: db.db,
    modelsRunner: options.modelsRunner,
    runner: options.taskRunner,
    worktrees: options.worktrees,
    testCommand: options.testCommand,
    encryptionKey: options.encryptionKey ?? config.FACTORY_ENCRYPTION_KEY,
  });
  await app.register(changesRoutes, { db: db.db, workflowProvider: options.workflowProvider });
  await app.register(decisionsRoutes, { db: db.db, workflowProvider: options.workflowProvider });
  await app.register(settingsRoutes, {
    db: db.db,
    encryptionKey: options.encryptionKey ?? config.FACTORY_ENCRYPTION_KEY,
  });
  await app.register(favoritesRoutes, { db: db.db });
  await app.register(sessionsRoutes, {
    db: db.db,
    sessions:
      options.sessions ??
      new SessionManager(db.db, {
        runner: options.taskRunner,
        worktrees: options.worktrees,
        testCommand: options.testCommand,
        encryptionKey: options.encryptionKey ?? config.FACTORY_ENCRYPTION_KEY,
      }),
  });

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
