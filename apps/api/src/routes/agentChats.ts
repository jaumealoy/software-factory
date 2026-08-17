import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import type { AgentChatManager } from "../agent/chat.js";
import { ChatClosedError } from "../agent/chat.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";

export interface AgentChatsRoutesOptions {
  db: Db;
  chats: AgentChatManager;
}

interface CreateChatBody {
  title?: string;
  projectId?: string;
}

interface SendMessageBody {
  text?: string;
}

function sseFrame(message: {
  id: number;
  chatId: string;
  direction: string;
  text: string;
  timestamp: string;
}): string {
  const payload = JSON.stringify(message);
  return `id: ${message.id}\nevent: ${message.direction}_message\ndata: ${payload}\n\n`;
}

export const agentChatsRoutes: FastifyPluginAsync<AgentChatsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { chats } = options;

  fastify.post<{ Body: CreateChatBody }>("/api/agent-chats", async (request, reply) => {
    const chat = chats.create({
      title: request.body?.title,
      projectId: request.body?.projectId,
    });
    return reply.code(201).send({ chat });
  });

  fastify.get<{ Querystring: { projectId?: string } }>("/api/agent-chats", async (request) => {
    return { chats: chats.list(request.query.projectId) };
  });

  fastify.get<{ Params: { id: string } }>("/api/agent-chats/:id", async (request, reply) => {
    try {
      const chat = chats.get(request.params.id);
      return { chat, messages: chats.messages(request.params.id) };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/agent-chats/:id/messages",
    async (request, reply) => {
      try {
        return { messages: chats.messages(request.params.id) };
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: SendMessageBody }>(
    "/api/agent-chats/:id/messages",
    async (request, reply) => {
      const text = request.body?.text?.trim() ?? "";
      if (!text) {
        return reply.code(422).send({ error: "text is required" });
      }
      try {
        const message = await chats.sendMessage(request.params.id, text);
        return reply.code(201).send({ message });
      } catch (error) {
        if (error instanceof ChatClosedError) {
          return reply.code(422).send({ error: error.message });
        }
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        if (error instanceof NotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>("/api/agent-chats/:id/close", async (request, reply) => {
    try {
      return { chat: chats.close(request.params.id) };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/agent-chats/:id/stream", async (request, reply) => {
    let chat;
    try {
      chat = chats.get(request.params.id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
    const chatId = request.params.id;

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write("retry: 1000\n\n");

    const lastEventId = Number(request.headers["last-event-id"] ?? 0);
    for (const message of chats.replay(chatId, Number.isFinite(lastEventId) ? lastEventId : 0)) {
      raw.write(sseFrame(message));
    }

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (!raw.writableEnded) raw.end();
    };
    const unsubscribe = chats.subscribe(chatId, (message) => raw.write(sseFrame(message)));
    raw.on("close", close);
    raw.on("error", close);

    if (chat.status !== "ACTIVE") {
      close();
    }
  });
};
