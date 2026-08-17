import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { executionSessions, sessionEvents, type ExecutionSession } from "../db/index.js";
import { NotFoundError } from "./errors.js";

export type SessionStatus = "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";

export interface StoredSessionEvent {
  id: number;
  type: string;
  stage: string | null;
  message: string | null;
  detail: string | null;
  data: Record<string, unknown> | null;
  timestamp: string;
}

export function createSession(db: Db, taskId: string): ExecutionSession {
  const session = db
    .insert(executionSessions)
    .values({ id: crypto.randomUUID(), taskId, status: "RUNNING" })
    .returning()
    .get();
  return session;
}

export function getSession(db: Db, sessionId: string): ExecutionSession {
  const session = db
    .select()
    .from(executionSessions)
    .where(eq(executionSessions.id, sessionId))
    .get();
  if (!session) {
    throw new NotFoundError("execution session", sessionId);
  }
  return session;
}

export function setSessionOutcome(
  db: Db,
  sessionId: string,
  status: SessionStatus,
  outcome: string | null,
  error: string | null = null,
): void {
  db.update(executionSessions)
    .set({
      status,
      outcome,
      error,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(executionSessions.id, sessionId))
    .run();
}

export function appendSessionEvent(
  db: Db,
  sessionId: string,
  event: {
    type: string;
    stage?: string | null;
    message?: string | null;
    detail?: string | null;
    data?: Record<string, unknown> | null;
    timestamp?: string;
  },
): StoredSessionEvent {
  const createdAt = new Date(event.timestamp ?? new Date().toISOString());
  const row = db
    .insert(sessionEvents)
    .values({
      sessionId,
      type: event.type,
      stage: event.stage ?? null,
      message: event.message ?? null,
      detail: event.detail ?? null,
      dataJson: event.data ? JSON.stringify(event.data) : null,
      createdAt,
    })
    .returning()
    .get();
  return {
    id: row.id,
    type: row.type,
    stage: row.stage,
    message: row.message,
    detail: row.detail,
    data: row.dataJson ? JSON.parse(row.dataJson) : null,
    timestamp: row.createdAt.toISOString(),
  };
}

export function replaySessionEvents(db: Db, sessionId: string, afterId = 0): StoredSessionEvent[] {
  const rows =
    afterId > 0
      ? db
          .select()
          .from(sessionEvents)
          .where(and(eq(sessionEvents.sessionId, sessionId), gt(sessionEvents.id, afterId)))
          .orderBy(asc(sessionEvents.id))
          .all()
      : db
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.sessionId, sessionId))
          .orderBy(asc(sessionEvents.id))
          .all();
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    stage: row.stage,
    message: row.message,
    detail: row.detail,
    data: row.dataJson ? JSON.parse(row.dataJson) : null,
    timestamp: row.createdAt.toISOString(),
  }));
}

export type ChatDirection = "user" | "agent";

export interface ChatMessage {
  id: number;
  sessionId: string;
  direction: ChatDirection;
  text: string;
  timestamp: string;
}

const CHAT_EVENT = {
  user: "user_message",
  agent: "agent_message",
} satisfies Record<ChatDirection, string>;

/** Records a chat message as a session event so it appears in the streamed transcript. */
export function recordSessionMessage(
  db: Db,
  sessionId: string,
  direction: ChatDirection,
  text: string,
): StoredSessionEvent {
  return appendSessionEvent(db, sessionId, {
    type: CHAT_EVENT[direction],
    stage: null,
    message: direction === "user" ? "You" : "Agent",
    detail: null,
    data: { direction, text },
  });
}

/** Returns the chat transcript for a session (user + agent messages, in order). */
export function listChatMessages(db: Db, sessionId: string): ChatMessage[] {
  const rows = db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(asc(sessionEvents.id))
    .all();
  return rows
    .filter((row) => row.type === "user_message" || row.type === "agent_message")
    .map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      direction: row.type === "agent_message" ? ("agent" as const) : ("user" as const),
      text: (row.dataJson ? (JSON.parse(row.dataJson) as { text?: string }).text : undefined) ?? "",
      timestamp: row.createdAt.toISOString(),
    }));
}

/** Returns pending user messages the agent has not yet consumed (id > afterId). */
export function listPendingUserMessages(db: Db, sessionId: string, afterId = 0): ChatMessage[] {
  const messages = listChatMessages(db, sessionId).filter((message) => message.id > afterId);
  return messages.filter((message) => message.direction === "user");
}
