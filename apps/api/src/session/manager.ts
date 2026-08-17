import { EventEmitter } from "node:events";
import type { Db } from "../db/index.js";
import type { Task } from "../db/index.js";
import { getTask } from "../domain/tasks.js";
import { runTaskWithResolvedModel, type RunOutcome } from "../execution/orchestrator.js";
import type { TaskRunner } from "../runner/index.js";
import type { WorktreeManager } from "../worktree/index.js";
import {
  appendSessionEvent,
  createSession,
  getSession,
  replaySessionEvents,
  setSessionOutcome,
  type StoredSessionEvent,
} from "../domain/sessions.js";

export interface SessionManagerOptions {
  maxConcurrent?: number;
  testCommand?: string;
  runner?: TaskRunner;
  worktrees?: WorktreeManager;
}

export interface StartSessionInput {
  taskId: string;
  repositoryPath: string;
  model?: string;
  changeName?: string;
}

export class ConcurrencyLimitError extends Error {
  constructor() {
    super("Too many concurrent execution sessions");
    this.name = "ConcurrencyLimitError";
  }
}

const TERMINAL_BY_OUTCOME: Record<RunOutcome, string> = {
  DONE: "session_completed",
  REWORK: "session_failed",
  ESCALATED: "session_failed",
  FAILED: "session_failed",
};

export class SessionManager {
  private emitter = new EventEmitter();
  private active = 0;
  private runs = new Map<string, Promise<void>>();
  readonly maxConcurrent: number;

  constructor(
    private readonly db: Db,
    private readonly options: SessionManagerOptions = {},
  ) {
    this.maxConcurrent = options.maxConcurrent ?? 5;
  }

  /** Starts a task run in the background and returns a streamable session. */
  async start(input: StartSessionInput): Promise<{ sessionId: string; streamUrl: string }> {
    if (this.active >= this.maxConcurrent) {
      throw new ConcurrencyLimitError();
    }
    const task = getTask(this.db, input.taskId);
    const session = createSession(this.db, input.taskId);

    this.active += 1;
    const runPromise = this.run(task, session.id, input)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setSessionOutcome(this.db, session.id, "FAILED", "FAILED", message);
        this.dispatch(
          session.id,
          appendSessionEvent(this.db, session.id, {
            type: "session_failed",
            stage: "COMPLETED",
            message,
            detail: null,
            data: { error: message },
          }),
        );
      })
      .finally(() => {
        this.active -= 1;
      });

    // Keep the promise referenced so callers can await completion in tests.
    this.runs.set(session.id, runPromise as Promise<void>);
    return { sessionId: session.id, streamUrl: `/api/sessions/${session.id}/stream` };
  }

  /** Awaits all currently running sessions (used by callers that must close the DB afterwards). */
  async drain(): Promise<void> {
    await Promise.all([...this.runs.values()]);
    this.runs.clear();
  }

  /** Awaits the (already started) background run for this session. */
  async awaitCompletion(sessionId: string): Promise<void> {
    await this.runs.get(sessionId);
  }

  subscribe(sessionId: string, handler: (event: StoredSessionEvent) => void): () => void {
    this.emitter.on(sessionId, handler);
    return () => this.emitter.off(sessionId, handler);
  }

  replay(sessionId: string, afterId = 0): StoredSessionEvent[] {
    return replaySessionEvents(this.db, sessionId, afterId);
  }

  private dispatch(sessionId: string, event: StoredSessionEvent): void {
    setImmediate(() => this.emitter.emit(sessionId, event));
  }

  private async run(task: Task, sessionId: string, input: StartSessionInput): Promise<void> {
    this.dispatch(
      sessionId,
      appendSessionEvent(this.db, sessionId, {
        type: "started",
        stage: null,
        message: `Starting task ${task.objective}`,
        detail: null,
        data: { taskId: task.id, changeId: task.changeId, model: input.model ?? null },
      }),
    );

    const result = await runTaskWithResolvedModel(this.db, {
      taskId: task.id,
      repositoryPath: input.repositoryPath,
      changeName: input.changeName,
      runner: this.options.runner,
      worktrees: this.options.worktrees,
      testCommand: this.options.testCommand,
      onEvent: (event) => {
        const stored = appendSessionEvent(this.db, sessionId, {
          type: event.type,
          stage: event.stage ?? null,
          message: event.message ?? null,
          detail: event.detail ?? null,
          data: event.data ?? null,
          timestamp: event.timestamp,
        });
        this.dispatch(sessionId, stored);
      },
    });

    const terminal = TERMINAL_BY_OUTCOME[result.outcome];
    const session = getSession(this.db, sessionId);
    const status = result.outcome === "DONE" ? "COMPLETED" : "FAILED";
    setSessionOutcome(this.db, sessionId, status, result.outcome);
    const stored = appendSessionEvent(this.db, sessionId, {
      type: terminal,
      stage: "COMPLETED",
      message:
        result.outcome === "DONE"
          ? "Task completed successfully"
          : `Task ended with outcome ${result.outcome}`,
      detail: null,
      data: { outcome: result.outcome, phaseResults: result.phaseResults.length },
    });
    this.dispatch(sessionId, stored);
    void session;
  }
}
