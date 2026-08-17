import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { migrationsDir } from "../../src/paths.js";
import { AgentChatManager, type ChatAgent } from "../../src/agent/chat.js";

const config: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
};

const handles: DbHandle[] = [];
const apps: FastifyInstance[] = [];
const managers: AgentChatManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.drain()));
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
});

function cannedAgent(reply: string): ChatAgent {
  return {
    async reply() {
      return reply;
    },
  };
}

async function makeServer(agent?: ChatAgent) {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  const manager = new AgentChatManager(db.db, agent ?? cannedAgent("Understood, I'll do that."));
  managers.push(manager);
  const app = await buildApp({
    db,
    config,
    scheduleMigrations: false,
    serveWeb: false,
    agentChats: manager,
  });
  apps.push(app);
  return { app, manager };
}

function parseFrames(body: string): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (const block of body.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      frames.push(JSON.parse(dataLine.slice(6)));
    } catch {
      // ignore keepalive
    }
  }
  return frames;
}

describe("standalone agent chat sessions (#36)", () => {
  it("creates a chat, sends a message, and receives an agent reply", async () => {
    const { app, manager } = await makeServer();

    const created = await app.inject({
      method: "POST",
      url: "/api/agent-chats",
      payload: { title: "Help with auth" },
    });
    expect(created.statusCode).toBe(201);
    const chatId = created.json().chat.id as string;

    const sent = await app.inject({
      method: "POST",
      url: `/api/agent-chats/${chatId}/messages`,
      payload: { text: "Add Google OAuth" },
    });
    expect(sent.statusCode).toBe(201);
    await manager.awaitReply(chatId);

    const detail = await app.inject({ method: "GET", url: `/api/agent-chats/${chatId}` });
    const messages = detail.json().messages as Array<{ direction: string; text: string }>;
    expect(messages).toEqual([
      expect.objectContaining({ direction: "user", text: "Add Google OAuth" }),
      expect.objectContaining({ direction: "agent", text: "Understood, I'll do that." }),
    ]);
  });

  it("lists chats and keeps transcripts per chat", async () => {
    const { app, manager } = await makeServer(cannedAgent("ok"));

    const a = await app.inject({ method: "POST", url: "/api/agent-chats", payload: {} });
    const b = await app.inject({ method: "POST", url: "/api/agent-chats", payload: {} });
    const aId = a.json().chat.id as string;
    const bId = b.json().chat.id as string;

    await app.inject({
      method: "POST",
      url: `/api/agent-chats/${aId}/messages`,
      payload: { text: "hello A" },
    });
    await manager.awaitReply(aId);

    const list = await app.inject({ method: "GET", url: "/api/agent-chats" });
    expect((list.json().chats as Array<{ id: string }>).map((c) => c.id)).toEqual(
      expect.arrayContaining([aId, bId]),
    );

    const aMessages = await app.inject({ method: "GET", url: `/api/agent-chats/${aId}/messages` });
    expect(aMessages.json().messages).toHaveLength(2);
    const bMessages = await app.inject({ method: "GET", url: `/api/agent-chats/${bId}/messages` });
    expect(bMessages.json().messages).toHaveLength(0);
  });

  it("rejects messages after the chat is closed", async () => {
    const { app } = await makeServer();
    const created = await app.inject({ method: "POST", url: "/api/agent-chats", payload: {} });
    const chatId = created.json().chat.id as string;

    const closed = await app.inject({ method: "POST", url: `/api/agent-chats/${chatId}/close` });
    expect(closed.json().chat.status).toBe("CLOSED");

    const res = await app.inject({
      method: "POST",
      url: `/api/agent-chats/${chatId}/messages`,
      payload: { text: "too late" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("streams the transcript over SSE and closes after the chat is closed", async () => {
    const { app, manager } = await makeServer();
    const created = await app.inject({ method: "POST", url: "/api/agent-chats", payload: {} });
    const chatId = created.json().chat.id as string;

    await app.inject({
      method: "POST",
      url: `/api/agent-chats/${chatId}/messages`,
      payload: { text: "ping" },
    });
    await manager.awaitReply(chatId);
    await app.inject({ method: "POST", url: `/api/agent-chats/${chatId}/close` });

    const stream = await app.inject({ method: "GET", url: `/api/agent-chats/${chatId}/stream` });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");

    const frames = parseFrames(stream.body as string).map((f) => f.direction);
    expect(frames).toEqual(["user", "agent"]);
  });

  it("records an agent error message when the reply generation fails", async () => {
    const failing: ChatAgent = {
      async reply() {
        throw new Error("provider exploded");
      },
    };
    const { app, manager } = await makeServer(failing);
    const created = await app.inject({ method: "POST", url: "/api/agent-chats", payload: {} });
    const chatId = created.json().chat.id as string;

    await app.inject({
      method: "POST",
      url: `/api/agent-chats/${chatId}/messages`,
      payload: { text: "hi" },
    });
    await manager.awaitReply(chatId);

    const detail = await app.inject({ method: "GET", url: `/api/agent-chats/${chatId}` });
    const texts = (detail.json().messages as Array<{ text: string }>).map((m) => m.text);
    expect(texts[1]).toContain("provider exploded");
  });
});
