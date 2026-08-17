import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { listDirectory, readFileContent, writeFileContent } from "../domain/files.js";
import { defaultRootResolver } from "./repoRoot.js";

export interface FilesRoutesOptions {
  db: Db;
  /** Resolves the repo root for a project (defaults to the primary repository localPath). */
  resolveRoot?: (projectId: string) => string | null;
}

export const filesRoutes: FastifyPluginAsync<FilesRoutesOptions> = async (fastify, options) => {
  const resolveRoot = options.resolveRoot ?? defaultRootResolver(options.db);

  fastify.get<{ Params: { projectId: string }; Querystring: { path?: string } }>(
    "/api/projects/:projectId/files",
    async (request, reply) => {
      const root = resolveRoot(request.params.projectId);
      if (!root) {
        return { exists: false, path: ".", entries: [], message: "No repository configured" };
      }
      try {
        return listDirectory(root, request.query.path ?? "");
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.get<{ Params: { projectId: string }; Querystring: { path?: string } }>(
    "/api/projects/:projectId/files/content",
    async (request, reply) => {
      if (!request.query.path) {
        return reply.code(422).send({ error: "path is required" });
      }
      const root = resolveRoot(request.params.projectId);
      if (!root) {
        return reply.code(404).send({ error: "No repository configured for this project" });
      }
      try {
        return readFileContent(root, request.query.path);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.put<{
    Params: { projectId: string };
    Body: { path?: string; content?: string };
  }>("/api/projects/:projectId/files", async (request, reply) => {
    const filePath = request.body?.path;
    if (!filePath) {
      return reply.code(422).send({ error: "path is required" });
    }
    const root = resolveRoot(request.params.projectId);
    if (!root) {
      return reply.code(404).send({ error: "No repository configured for this project" });
    }
    try {
      return writeFileContent(root, filePath, request.body.content ?? "");
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(422).send({ error: error.message });
      }
      throw error;
    }
  });
};
