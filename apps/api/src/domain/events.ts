import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { events } from "../db/index.js";

export type EntityType = "project" | "change" | "capability" | "task" | "decision" | "artifact";

export interface RecordEventInput {
  entityType: EntityType;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

export function recordEvent(db: Db, input: RecordEventInput): void {
  db.insert(events)
    .values({
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      payloadJson: input.payload !== undefined ? JSON.stringify(input.payload) : undefined,
    })
    .run();
}

export interface ListEventsInput {
  entityType: EntityType;
  entityId: string;
  limit?: number;
}

export function listEvents(db: Db, input: ListEventsInput) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.entityType, input.entityType), eq(events.entityId, input.entityId)))
    .orderBy(desc(events.createdAt))
    .limit(input.limit ?? 100)
    .all();
}
