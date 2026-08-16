import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { capabilities, type Capability } from "../db/index.js";
import type { Db } from "../db/index.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";
import { getChange } from "./changes.js";

export interface AddCapabilityInput {
  changeId: string;
  name: string;
  summary?: string;
  parentCapabilityId?: string;
  position?: number;
}

export function addCapability(db: Db, input: AddCapabilityInput): Capability {
  getChange(db, input.changeId);

  if (!input.name.trim()) {
    throw new ValidationError("Capability name is required");
  }

  let parentCapabilityId: string | undefined;
  if (input.parentCapabilityId) {
    const parent = db
      .select()
      .from(capabilities)
      .where(
        and(
          eq(capabilities.id, input.parentCapabilityId),
          eq(capabilities.changeId, input.changeId),
        ),
      )
      .get();
    if (!parent) {
      throw new NotFoundError("parent capability", input.parentCapabilityId);
    }
    parentCapabilityId = parent.id;
  }

  const position =
    input.position ??
    db.select().from(capabilities).where(eq(capabilities.changeId, input.changeId)).all().length ??
    0;

  const capability = db
    .insert(capabilities)
    .values({
      id: randomUUID(),
      changeId: input.changeId,
      parentCapabilityId,
      name: input.name.trim(),
      summary: input.summary?.trim() || undefined,
      position,
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "capability",
    entityId: capability.id,
    eventType: "capability.created",
    payload: { changeId: input.changeId, name: capability.name, position },
  });
  return capability;
}

export function listCapabilities(db: Db, changeId: string): Capability[] {
  return db
    .select()
    .from(capabilities)
    .where(eq(capabilities.changeId, changeId))
    .orderBy(asc(capabilities.position))
    .all();
}
