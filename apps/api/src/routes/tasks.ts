import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { DomainError, NotFoundError, ValidationError } from "../domain/errors.js";
import { assertModelAvailable, resolveTaskModel, setTaskModel } from "../domain/models.js";
import { getTask } from "../domain/tasks.js";
import { listAvailableModels } from "../kilo/models.js";
import {
  runTask,
  runTaskWithResolvedModel,
  type RunTaskResult,
} from "../execution/orchestrator.js";
import { listArtifacts } from "../domain/artifacts.js";
import type { TaskRunner } from "../runner/index.js";
import type { WorktreeManager } from "../worktree/index.js";

export interface TasksRoutesOptions {
  db: Db;
  modelsRunner?: () => Promise<string>;
  runner?: TaskRunner;
  worktrees?: WorktreeManager;
  testCommand?: string;
  encryptionKey?: string;
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

  fastify.post<{ Params: { taskId: string }; Body: { repositoryPath: string; model?: string } }>(
    "/api/tasks/:taskId/run",
    async (request, reply) => {
      try {
        if (!request.body?.repositoryPath) {
          return reply.code(422).send({ error: "repositoryPath is required" });
        }
        let result: RunTaskResult;
        if (request.body.model) {
          result = await runTask(options.db, {
            taskId: request.params.taskId,
            repositoryPath: request.body.repositoryPath,
            model: request.body.model,
            runner: options.runner,
            worktrees: options.worktrees,
            testCommand: options.testCommand,
            encryptionKey: options.encryptionKey,
          });
        } else {
          result = await runTaskWithResolvedModel(options.db, {
            taskId: request.params.taskId,
            repositoryPath: request.body.repositoryPath,
            runner: options.runner,
            worktrees: options.worktrees,
            testCommand: options.testCommand,
            encryptionKey: options.encryptionKey,
          });
        }
        return reply.code(result.outcome === "ESCALATED" ? 202 : 200).send({ result });
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof DomainError) {
          return reply.code(409).send({ error: error.message });
        }
        fastify.log.error({ err: error }, "task run failed");
        return reply.code(500).send({ error: (error as Error).message });
      }
    },
  );

  fastify.get<{ Params: { taskId: string } }>("/api/tasks/:taskId/runs", async (request, reply) => {
    try {
      getTask(options.db, request.params.taskId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
    const artifacts = listArtifacts(options.db, { taskId: request.params.taskId });
    const runs = artifacts
      .filter((artifact) => artifact.uri?.startsWith("run://"))
      .map((artifact) => {
        let payload: unknown = null;
        try {
          payload = artifact.validationResult ? JSON.parse(artifact.validationResult) : null;
        } catch {
          payload = null;
        }
        return { id: artifact.id, createdAt: artifact.createdAt, payload };
      });
    return { runs };
  });
};
