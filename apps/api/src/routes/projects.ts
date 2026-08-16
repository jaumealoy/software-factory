import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { listProjects, getProjectWithRepositories } from "../domain/projects.js";
import { NotFoundError } from "../domain/errors.js";

export interface ProjectRoutesOptions {
  db: Db;
}

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (fastify, options) => {
  fastify.get("/api/projects", async () => {
    return listProjects(options.db);
  });

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply) => {
      try {
        return getProjectWithRepositories(options.db, request.params.projectId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );
};
