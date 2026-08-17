import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agentChatMessages, agentChats, type AgentChat } from "../db/index.js";
import { NotFoundError, ValidationError } from "./errors.js";

export type ChatDirection = "user" | "agent";
export type ChatStatus = "ACTIVE" | "CLOSED";

export interface StoredChatMessage {
  id: number;
  chatId: string;
  direction: ChatDirection;
  text: string;
  timestamp: string;
}

export interface AgentChatView {
  id: string;
  projectId: string | null;
  title: string;
  status: ChatStatus;
  createdAt: string;
  updatedAt: string;
}

function toView(chat: AgentChat): AgentChatView {
  return {
    id: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    status: chat.status as ChatStatus,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

export function createAgentChat(
  db: Db,
  input: { title?: string; projectId?: string },
): AgentChatView {
  const chat = db
    .insert(agentChats)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId ?? null,
      title: input.title?.trim() || "New chat",
    })
    .returning()
    .get();
  return toView(chat);
}

export function getAgentChat(db: Db, chatId: string): AgentChatView {
  const chat = db.select().from(agentChats).where(eq(agentChats.id, chatId)).get();
  if (!chat) {
    throw new NotFoundError("agent chat", chatId);
  }
  return toView(chat);
}

export function listAgentChats(db: Db, projectId?: string): AgentChatView[] {
  const rows = projectId
    ? db.select().from(agentChats).where(eq(agentChats.projectId, projectId)).all()
    : db.select().from(agentChats).all();
  return rows.map((chat) => toView(chat));
}

export function setChatStatus(db: Db, chatId: string, status: ChatStatus): AgentChatView {
  getAgentChat(db, chatId);
  db.update(agentChats)
    .set({ status, updatedAt: new Date() })
    .where(eq(agentChats.id, chatId))
    .run();
  return getAgentChat(db, chatId);
}

export function appendChatMessage(
  db: Db,
  chatId: string,
  direction: ChatDirection,
  text: string,
): StoredChatMessage {
  const content = text.trim();
  if (!content) {
    throw new ValidationError("Message text must not be empty");
  }
  const row = db
    .insert(agentChatMessages)
    .values({ chatId, direction, text: content })
    .returning()
    .get();
  return {
    id: row.id,
    chatId: row.chatId,
    direction: row.direction as ChatDirection,
    text: row.text,
    timestamp: row.createdAt.toISOString(),
  };
}

export function listChatMessages(db: Db, chatId: string): StoredChatMessage[] {
  getAgentChat(db, chatId);
  return db
    .select()
    .from(agentChatMessages)
    .where(eq(agentChatMessages.chatId, chatId))
    .orderBy(asc(agentChatMessages.id))
    .all()
    .map((row) => ({
      id: row.id,
      chatId: row.chatId,
      direction: row.direction as ChatDirection,
      text: row.text,
      timestamp: row.createdAt.toISOString(),
    }));
}

export function pendingMessages(db: Db, chatId: string, afterId: number): StoredChatMessage[] {
  return listChatMessages(db, chatId).filter((message) => message.id > afterId);
}
