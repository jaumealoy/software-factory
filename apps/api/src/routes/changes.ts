import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { listChanges, getChange } from "../domain/changes.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { listPendingDecisions } from "../domain/decisions.js";
import { listCapabilities } from "../domain/capabilities.js";
import { getTaskGraph, listTasks } from "../domain/tasks.js";
import { listArtifacts } from "../domain/artifacts.js";
import { listEvents } from "../domain/events.js";
import { runWorkflow } from "../workflow/orchestrator.js";
import type { WorkflowProvider } from "../workflow/types.js";

export interface ChangesRoutesOptions {
  db: Db;
  workflowProvider?: WorkflowProvider;
}

export const changesRoutes: FastifyPluginAsync<ChangesRoutesOptions> = async (fastify, options) => {
  fastify.get("/api/changes", async (request) => {
    const query = request.query as { projectId?: string };
    return listChanges(options.db, query.projectId);
  });

  fastify.get<{ Params: { changeId: string } }>(
    "/api/changes/:changeId",
    async (request, reply) => {
      try {
        const changeId = request.params.changeId;
        const change = getChange(options.db, changeId);
        const taskGraph = getTaskGraph(options.db, changeId);
        const [capabilities, tasks, pending, artifacts, events] = [
          listCapabilities(options.db, changeId),
          listTasks(options.db, changeId),
          listPendingDecisions(options.db, { changeId }),
          listArtifacts(options.db, { changeId }),
          listEvents(options.db, { entityType: "change", entityId: changeId, limit: 30 }),
        ];
        return {
          change,
          capabilities,
          tasks,
          taskGraph,
          pendingDecisions: pending,
          artifacts,
          events,
        };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.post<{
    Body: {
      projectId: string;
      title: string;
      requestText: string;
      repositoryPath: string;
    };
  }>("/api/changes", async (request, reply) => {
    const body = request.body;
    if (!body?.projectId || !body?.title || !body?.requestText || !body?.repositoryPath) {
      return reply
        .code(422)
        .send({ error: "projectId, title, requestText, and repositoryPath are required" });
    }

    try {
      const result = await runWorkflow(options.db, {
        projectId: body.projectId,
        title: body.title,
        requestText: body.requestText,
        repositoryPath: body.repositoryPath,
        provider: options.workflowProvider,
      });
      const pending =
        result.phase === "awaiting_decision"
          ? listPendingDecisions(options.db, { changeId: result.changeId })
          : [];
      return reply.code(result.phase === "awaiting_decision" ? 202 : 201).send({
        workflow: result,
        pendingDecisions: pending,
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.code(422).send({ error: error.message });
      }
      fastify.log.error({ err: error }, "runWorkflow failed");
      return reply.code(500).send({ error: "Workflow failed", detail: messageOf(error) });
    }
  });
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
