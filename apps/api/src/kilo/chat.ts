import type { ChatAgent, ChatReplyInput } from "../agent/chat.js";
import { KiloCliExecutor, type KiloExecutor } from "./client.js";
import { buildKiloEnv } from "./credentials.js";
import type { Db } from "../db/index.js";

const DEFAULT_MODEL = "kilo/anthropic/claude-haiku-4.5";

/** Formats a chat conversation into a single prompt for the agent. */
export function buildChatPrompt(history: ChatReplyInput["history"]): string {
  const lines = history.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.text}`);
  return [
    "You are the Software Factory coding agent. Answer the user's questions about their codebase.",
    "",
    ...lines,
    "",
    "Agent:",
  ].join("\n");
}

export interface KiloChatAgentOptions {
  db?: Db;
  executor?: KiloExecutor;
  model?: string;
  /** Enables injecting configured provider credentials (#29). */
  encryptionKey?: string;
  /** Directory the agent runs in (e.g. the project's active folder). */
  dir?: string;
  timeoutMs?: number;
}

/** Generates chat replies by running the Kilo CLI headlessly over the conversation. */
export class KiloChatAgent implements ChatAgent {
  private readonly executor: KiloExecutor;
  private readonly model: string;
  private readonly dir: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: KiloChatAgentOptions = {}) {
    this.executor = options.executor ?? new KiloCliExecutor();
    this.model = options.model ?? DEFAULT_MODEL;
    this.dir = options.dir ?? ".";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async reply(input: ChatReplyInput): Promise<string> {
    const env =
      this.options.db && this.options.encryptionKey
        ? (buildKiloEnv(this.options.db, this.model, this.options.encryptionKey) ?? undefined)
        : undefined;
    const output = await this.executor.run({
      message: buildChatPrompt(input.history),
      model: this.model,
      dir: this.dir,
      timeoutMs: this.timeoutMs,
      ...(env ? { env } : {}),
    });
    const text = (output.stdout || output.stderr).trim();
    return text || "I could not produce an answer.";
  }
}
