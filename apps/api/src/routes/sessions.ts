import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { getSession } from "../domain/sessions.js";
import type { SessionManager } from "../session/manager.js";
import { ConcurrencyLimitError } from "../session/manager.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";
import { getTask } from "../domain/tasks.js";

export interface SessionsRoutesOptions {
  db: Db;
  sessions: SessionManager;
}

interface StartSessionBody {
  taskId?: string;
  repositoryPath?: string;
  model?: string;
  changeName?: string;
}

function sseFrame(event: {
  id: number;
  type: string;
  stage: string | null;
  message: string | null;
  detail: string | null;
  data: Record<string, unknown> | null;
}): string {
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    stage: event.stage,
    message: event.message,
    detail: event.detail,
    data: event.data,
  });
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${payload}\n\n`;
}

export const sessionsRoutes: FastifyPluginAsync<SessionsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { db, sessions } = options;

  fastify.post<{ Body: StartSessionBody }>("/api/sessions", async (request, reply) => {
    const { taskId, repositoryPath, model, changeName } = request.body ?? {};
    if (!taskId || !repositoryPath) {
      throw new ValidationError("taskId and repositoryPath are required");
    }
    getTask(db, taskId); // 404 if missing
    try {
      const started = await sessions.start({ taskId, repositoryPath, model, changeName });
      return reply.code(201).send(started);
    } catch (error) {
      if (error instanceof ConcurrencyLimitError) {
        return reply.code(429).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    try {
      const session = getSession(db, request.params.id);
      return { session };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/sessions/:id/stream", async (request, reply) => {
    let session;
    try {
      session = getSession(db, request.params.id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
    const sessionId = request.params.id;

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
    for (const event of sessions.replay(
      sessionId,
      Number.isFinite(lastEventId) ? lastEventId : 0,
    )) {
      raw.write(sseFrame(event));
    }

    const TERMINAL = new Set(["session_completed", "session_failed", "session_aborted"]);
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe();
      if (!raw.writableEnded) {
        raw.end();
      }
    };
    const unsubscribe = sessions.subscribe(sessionId, (event) => {
      raw.write(sseFrame(event));
      if (TERMINAL.has(event.type)) {
        close();
      }
    });
    raw.on("close", close);
    raw.on("error", close);

    if (session.status !== "RUNNING") {
      close();
    }
  });
};
