import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getChange } from "../domain/changes.js";
import { listPendingDecisions, resolveDecision } from "../domain/decisions.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { resumeWorkflow } from "../workflow/orchestrator.js";
import type { WorkflowProvider } from "../workflow/types.js";

export interface DecisionsRoutesOptions {
  db: Db;
  workflowProvider?: WorkflowProvider;
}

export const decisionsRoutes: FastifyPluginAsync<DecisionsRoutesOptions> = async (
  fastify,
  options,
) => {
  fastify.get<{ Querystring: { changeId?: string } }>("/api/decisions/pending", async (request) => {
    return listPendingDecisions(options.db, { changeId: request.query.changeId });
  });

  fastify.post<{
    Params: { decisionId: string };
    Body: { approved: boolean; resolutionNote?: string; repositoryPath?: string };
  }>("/api/decisions/:decisionId/resolve", async (request, reply) => {
    try {
      const decision = resolveDecision(options.db, {
        decisionId: request.params.decisionId,
        approved: request.body.approved,
        resolutionNote: request.body.resolutionNote,
      });
      const change = getChange(options.db, decision.changeId);

      if (!request.body.repositoryPath) {
        return reply.code(200).send({
          decision,
          workflow: null,
          warning: "repositoryPath was not provided; workflow was not resumed",
        });
      }

      const workflow = await resumeWorkflow(options.db, {
        changeId: change.id,
        repositoryPath: request.body.repositoryPath,
        provider: options.workflowProvider,
      });
      const pending =
        workflow.phase === "awaiting_decision"
          ? listPendingDecisions(options.db, { changeId: change.id })
          : [];
      return reply.code(workflow.phase === "awaiting_decision" ? 202 : 200).send({
        decision,
        workflow,
        pendingDecisions: pending,
      });
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
