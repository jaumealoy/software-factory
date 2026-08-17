import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { addFolder, listFolders, removeFolder, setActiveFolder } from "../domain/folders.js";
import { DuplicateError, NotFoundError, ValidationError } from "../domain/errors.js";

export interface FoldersRoutesOptions {
  db: Db;
}

export const foldersRoutes: FastifyPluginAsync<FoldersRoutesOptions> = async (fastify, options) => {
  const { db } = options;

  fastify.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/folders",
    async (request, reply) => {
      try {
        return { folders: listFolders(db, request.params.projectId) };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.post<{ Params: { projectId: string }; Body: { name?: string; path?: string } }>(
    "/api/projects/:projectId/folders",
    async (request, reply) => {
      try {
        const folder = addFolder(db, request.params.projectId, {
          name: request.body?.name ?? "",
          path: request.body?.path ?? "",
        });
        return reply.code(201).send({ folder });
      } catch (error) {
        if (error instanceof ValidationError || error instanceof DuplicateError) {
          return reply.code(422).send({ error: error.message });
        }
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.patch<{ Params: { projectId: string; folderId: string } }>(
    "/api/projects/:projectId/folders/:folderId",
    async (request, reply) => {
      try {
        const folders = setActiveFolder(db, request.params.projectId, request.params.folderId);
        return { folders };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.delete<{ Params: { projectId: string; folderId: string } }>(
    "/api/projects/:projectId/folders/:folderId",
    async (request, reply) => {
      try {
        const folders = removeFolder(db, request.params.projectId, request.params.folderId);
        return { folders };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );
};
