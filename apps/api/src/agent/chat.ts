import { EventEmitter } from "node:events";
import type { Db } from "../db/index.js";
import {
  appendChatMessage,
  createAgentChat,
  getAgentChat,
  listAgentChats,
  listChatMessages,
  pendingMessages,
  setChatStatus,
  type AgentChatView,
  type StoredChatMessage,
} from "../domain/agentChats.js";

export interface ChatTurn {
  role: "user" | "agent";
  text: string;
}

export interface ChatReplyInput {
  chatId: string;
  history: ChatTurn[];
}

/** Produces an agent reply for a chat conversation. */
export interface ChatAgent {
  reply(input: ChatReplyInput): Promise<string>;
}

export class ChatClosedError extends Error {
  constructor() {
    super("This chat has been closed and no longer accepts messages");
    this.name = "ChatClosedError";
  }
}

export class AgentChatManager {
  private emitter = new EventEmitter();
  private runs = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly agent: ChatAgent,
  ) {}

  create(input: { title?: string; projectId?: string }): AgentChatView {
    return createAgentChat(this.db, input);
  }

  list(projectId?: string): AgentChatView[] {
    return listAgentChats(this.db, projectId);
  }

  get(chatId: string): AgentChatView {
    return getAgentChat(this.db, chatId);
  }

  messages(chatId: string): StoredChatMessage[] {
    return listChatMessages(this.db, chatId);
  }

  close(chatId: string): AgentChatView {
    return setChatStatus(this.db, chatId, "CLOSED");
  }

  subscribe(chatId: string, handler: (message: StoredChatMessage) => void): () => void {
    this.emitter.on(chatId, handler);
    return () => this.emitter.off(chatId, handler);
  }

  replay(chatId: string, afterId = 0): StoredChatMessage[] {
    return pendingMessages(this.db, chatId, afterId);
  }

  /** Appends a user message and starts reply generation in the background. */
  async sendMessage(chatId: string, text: string): Promise<StoredChatMessage> {
    const chat = getAgentChat(this.db, chatId);
    if (chat.status !== "ACTIVE") {
      throw new ChatClosedError();
    }
    const stored = appendChatMessage(this.db, chatId, "user", text);
    this.dispatch(chatId, stored);
    const run = this.respond(chatId).catch((error: unknown) => {
      const notice = appendChatMessage(
        this.db,
        chatId,
        "agent",
        `Agent error: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.dispatch(chatId, notice);
    });
    this.runs.set(chatId, run);
    return stored;
  }

  async awaitReply(chatId: string): Promise<void> {
    await this.runs.get(chatId);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.runs.values()]);
    this.runs.clear();
  }

  private async respond(chatId: string): Promise<void> {
    const history = listChatMessages(this.db, chatId).map((message) => ({
      role: message.direction as ChatTurn["role"],
      text: message.text,
    }));
    const reply = await this.agent.reply({ chatId, history });
    const stored = appendChatMessage(this.db, chatId, "agent", reply);
    this.dispatch(chatId, stored);
  }

  private dispatch(chatId: string, message: StoredChatMessage): void {
    setImmediate(() => this.emitter.emit(chatId, message));
  }
}
