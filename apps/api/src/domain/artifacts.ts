import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { artifacts, changes, tasks, type Artifact } from "../db/index.js";
import type { Db } from "../db/index.js";
import { ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";
import type { ArtifactKind } from "./statuses.js";

export interface RecordArtifactInput {
  changeId?: string;
  taskId?: string;
  kind: ArtifactKind;
  path?: string;
  uri?: string;
  summary?: string;
  sourceRevision?: string;
  validationResult?: string;
}

export function recordArtifact(db: Db, input: RecordArtifactInput): Artifact {
  if (!input.changeId && !input.taskId) {
    throw new ValidationError("Artifact must be attached to a change or a task");
  }
  if (input.taskId) {
    const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
    if (!task) {
      throw new ValidationError(`Task ${input.taskId} does not exist`);
    }
  }
  if (input.changeId) {
    const change = db.select().from(changes).where(eq(changes.id, input.changeId)).get();
    if (!change) {
      throw new ValidationError(`Change ${input.changeId} does not exist`);
    }
  }

  const artifact = db
    .insert(artifacts)
    .values({
      id: randomUUID(),
      changeId: input.changeId,
      taskId: input.taskId,
      kind: input.kind,
      path: input.path?.trim() || undefined,
      uri: input.uri?.trim() || undefined,
      summary: input.summary?.trim() || undefined,
      sourceRevision: input.sourceRevision?.trim() || undefined,
      validationResult: input.validationResult?.trim() || undefined,
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "artifact",
    entityId: artifact.id,
    eventType: "artifact.recorded",
    payload: { kind: artifact.kind, changeId: input.changeId, taskId: input.taskId },
  });
  return artifact;
}

export interface ListArtifactsOptions {
  changeId?: string;
  taskId?: string;
}

export function listArtifacts(db: Db, options: ListArtifactsOptions = {}): Artifact[] {
  const conditions = [];
  if (options.changeId) {
    conditions.push(eq(artifacts.changeId, options.changeId));
  }
  if (options.taskId) {
    conditions.push(eq(artifacts.taskId, options.taskId));
  }
  const query = db.select().from(artifacts);
  const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
