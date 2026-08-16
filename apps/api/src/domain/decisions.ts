import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { decisions, type Decision } from "../db/index.js";
import type { Db } from "../db/index.js";
import { InvalidTransitionError, NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";
import { CHANGE_TRANSITIONS, type ChangeStatus, type DecisionStatus } from "./statuses.js";
import { getChange, transitionChange } from "./changes.js";

export interface RequestDecisionInput {
  changeId: string;
  problem: string;
  options: string[];
  recommendation?: string;
  rationale?: string;
  resumeStatus?: ChangeStatus;
}

export function requestDecision(db: Db, input: RequestDecisionInput): Decision {
  const change = getChange(db, input.changeId);

  if (!input.problem.trim() || input.options.length === 0) {
    throw new ValidationError("Decision problem and at least one option are required");
  }
  if (change.status === "DONE" || change.status === "CANCELLED") {
    throw new ValidationError(`Cannot request a decision for a ${change.status} change`);
  }

  const resumeStatus = input.resumeStatus ?? change.status;
  if (!CHANGE_TRANSITIONS["WAITING_FOR_DECISION"].includes(resumeStatus)) {
    throw new InvalidTransitionError("change", "WAITING_FOR_DECISION", resumeStatus);
  }

  const decision = db
    .insert(decisions)
    .values({
      id: randomUUID(),
      changeId: input.changeId,
      problem: input.problem.trim(),
      optionsJson: JSON.stringify(input.options),
      recommendation: input.recommendation?.trim() || undefined,
      rationale: input.rationale?.trim() || undefined,
      resumeStatus,
      status: "PENDING",
    })
    .returning()
    .get();

  transitionChange(db, input.changeId, "WAITING_FOR_DECISION");

  recordEvent(db, {
    entityType: "decision",
    entityId: decision.id,
    eventType: "decision.requested",
    payload: { changeId: input.changeId, problem: decision.problem },
  });
  return decision;
}

export interface ResolveDecisionInput {
  decisionId: string;
  approved: boolean;
  resolutionNote?: string;
}

export function resolveDecision(db: Db, input: ResolveDecisionInput): Decision {
  const decision = getDecision(db, input.decisionId);
  if (decision.status !== "PENDING") {
    throw new ValidationError("Decision is already resolved");
  }
  const resumeStatus = decision.resumeStatus;
  if (!resumeStatus) {
    throw new ValidationError("Decision has no resumable status");
  }

  transitionChange(db, decision.changeId, resumeStatus);

  const status: DecisionStatus = input.approved ? "APPROVED" : "DECLINED";
  const updated = db
    .update(decisions)
    .set({
      status,
      resolutionNote: input.resolutionNote?.trim() || undefined,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(decisions.id, input.decisionId))
    .returning()
    .get();

  recordEvent(db, {
    entityType: "decision",
    entityId: input.decisionId,
    eventType: "decision.resolved",
    payload: { changeId: decision.changeId, status, approved: input.approved },
  });
  return updated;
}

export function getDecision(db: Db, decisionId: string): Decision {
  const decision = db.select().from(decisions).where(eq(decisions.id, decisionId)).get();
  if (!decision) {
    throw new NotFoundError("decision", decisionId);
  }
  return decision;
}

export interface ListPendingDecisionsOptions {
  changeId?: string;
}

export function listPendingDecisions(
  db: Db,
  options: ListPendingDecisionsOptions = {},
): Decision[] {
  const conditions = [eq(decisions.status, "PENDING")];
  if (options.changeId) {
    conditions.push(eq(decisions.changeId, options.changeId));
  }
  return db
    .select()
    .from(decisions)
    .where(and(...conditions))
    .orderBy(asc(decisions.createdAt))
    .all();
}
