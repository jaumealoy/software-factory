import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { listProjects, getProjectWithRepositories } from "../domain/projects.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { assertModelAvailable, setProjectDefaultModel } from "../domain/models.js";
import { listAvailableModels } from "../kilo/models.js";

export interface ProjectRoutesOptions {
  db: Db;
  modelsRunner?: () => Promise<string>;
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

  fastify.patch<{
    Params: { projectId: string };
    Body: { model: string | null };
  }>("/api/projects/:projectId/model", async (request, reply) => {
    try {
      const model = request.body?.model?.trim() || null;
      if (model) {
        const available = await listAvailableModels(options.modelsRunner);
        assertModelAvailable(model, available);
      }
      setProjectDefaultModel(options.db, request.params.projectId, model);
      return getProjectWithRepositories(options.db, request.params.projectId);
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(422).send({ error: error.message });
      }
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });
};
