import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { assertModelAvailable, resolveTaskModel, setTaskModel } from "../domain/models.js";
import { getTask } from "../domain/tasks.js";
import { listAvailableModels } from "../kilo/models.js";

export interface TasksRoutesOptions {
  db: Db;
  modelsRunner?: () => Promise<string>;
}

export const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (fastify, options) => {
  fastify.get<{ Params: { taskId: string } }>("/api/tasks/:taskId", async (request, reply) => {
    try {
      const task = getTask(options.db, request.params.taskId);
      return { task, model: resolveTaskModel(options.db, task.id) };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.patch<{
    Params: { taskId: string };
    Body: { model: string | null };
  }>("/api/tasks/:taskId/model", async (request, reply) => {
    try {
      const model = request.body?.model?.trim() || null;
      if (model) {
        const available = await listAvailableModels(options.modelsRunner);
        assertModelAvailable(model, available);
      }
      setTaskModel(options.db, request.params.taskId, model);
      const task = getTask(options.db, request.params.taskId);
      return { task, model: resolveTaskModel(options.db, task.id) };
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
