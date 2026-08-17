import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { ValidationError } from "../domain/errors.js";
import { buildWorkingDiff } from "../git/diff.js";
import { defaultRootResolver } from "./repoRoot.js";

export interface DiffRoutesOptions {
  db: Db;
  resolveRoot?: (projectId: string) => string | null;
}

export const diffRoutes: FastifyPluginAsync<DiffRoutesOptions> = async (fastify, options) => {
  const resolveRoot = options.resolveRoot ?? defaultRootResolver(options.db);

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/diff",
    async (request, reply) => {
      const root = resolveRoot(request.params.projectId);
      if (!root) {
        return reply.code(404).send({ error: "No repository configured for this project" });
      }
      try {
        return { diff: buildWorkingDiff(root) };
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );
};
