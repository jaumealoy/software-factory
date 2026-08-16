import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";

export interface HealthRouteOptions {
  db: Db;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  fastify.get("/api/health", async (_request, reply) => {
    try {
      options.db.get(sql`select 1 as ok`);
      return reply.send({
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error({ err: error }, "health check failed");
      return reply.code(503).send({
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  });
};
