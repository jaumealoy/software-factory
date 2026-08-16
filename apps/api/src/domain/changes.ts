import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { changes, factoryProjects, type Change } from "../db/index.js";
import type { Db } from "../db/index.js";
import { InvalidTransitionError, NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";
import { canTransitionChange, type ChangeStatus } from "./statuses.js";

export interface CreateChangeInput {
  projectId: string;
  title: string;
  requestText: string;
  summary?: string;
}

export function createChange(db: Db, input: CreateChangeInput): Change {
  const project = db
    .select()
    .from(factoryProjects)
    .where(eq(factoryProjects.id, input.projectId))
    .get();
  if (!project) {
    throw new NotFoundError("project", input.projectId);
  }
  if (!input.title.trim() || !input.requestText.trim()) {
    throw new ValidationError("Change title and request text are required");
  }

  const change = db
    .insert(changes)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title.trim(),
      requestText: input.requestText.trim(),
      summary: input.summary?.trim() || undefined,
      status: "CREATED",
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "change",
    entityId: change.id,
    eventType: "change.created",
    payload: { title: change.title, projectId: change.projectId },
  });
  return change;
}

export function getChange(db: Db, changeId: string): Change {
  const change = db.select().from(changes).where(eq(changes.id, changeId)).get();
  if (!change) {
    throw new NotFoundError("change", changeId);
  }
  return change;
}

export function listChanges(db: Db, projectId?: string): Change[] {
  const query = db.select().from(changes);
  const rows = projectId ? query.where(eq(changes.projectId, projectId)).all() : query.all();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function transitionChange(db: Db, changeId: string, to: ChangeStatus): Change {
  const change = getChange(db, changeId);
  if (!canTransitionChange(change.status, to)) {
    throw new InvalidTransitionError("change", change.status, to);
  }

  const updated = db
    .update(changes)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(changes.id, changeId))
    .returning()
    .get();

  recordEvent(db, {
    entityType: "change",
    entityId: changeId,
    eventType: "change.status_changed",
    payload: { from: change.status, to },
  });
  return updated;
}
