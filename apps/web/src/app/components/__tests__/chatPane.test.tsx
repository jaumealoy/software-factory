import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPane } from "../chatPane";

let lastSource: FakeEventSource | null = null;

function renderPane(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ChatPane />
    </MemoryRouter>,
  );
}

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastSource = this;
  }
  close(): void {
    this.closed = true;
  }
  trigger(event: { id: number } & Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  lastSource = null;
});

const session = {
  id: "s1",
  taskId: "t1",
  status: "RUNNING" as const,
  outcome: null,
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
};

function stubApi() {
  vi.stubGlobal("EventSource", FakeEventSource);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });
    if (method === "POST" && url === "/api/sessions") {
      return json({ sessionId: "s1", streamUrl: "/api/sessions/s1/stream" }, 201);
    }
    if (method === "GET" && url === "/api/sessions/s1/messages") {
      return json({
        messages: [
          {
            id: 1,
            sessionId: "s1",
            direction: "user",
            text: "hi",
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }
    if (method === "GET" && url === "/api/sessions/s1") {
      return json({ session });
    }
    if (method === "POST" && url === "/api/sessions/s1/messages") {
      return json(
        {
          message: {
            id: 2,
            type: "user_message",
            stage: null,
            message: null,
            data: { text: "hello" },
          },
        },
        201,
      );
    }
    if (method === "POST" && url === "/api/agent-chats") {
      return json(
        {
          chat: {
            id: "c1",
            projectId: null,
            title: "New chat",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        201,
      );
    }
    if (method === "GET" && url === "/api/agent-chats/c1/messages") {
      return json({ messages: [] });
    }
    if (method === "POST" && url === "/api/agent-chats/c1/messages") {
      return json(
        {
          message: {
            id: 5,
            chatId: "c1",
            direction: "user",
            text: "hello from chat",
            timestamp: new Date().toISOString(),
          },
        },
        201,
      );
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: `no handler for ${method} ${url}` }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("live chat pane (#26)", () => {
  it("attaches to a running session from the URL (?session=)", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderPane("/?session=s1");

    expect(await screen.findByText("hi")).toBeInTheDocument();
    const source = await waitFor(() => {
      const s = lastSource;
      expect(s).not.toBeNull();
      return s!;
    });
    expect(source.url).toBe("/api/sessions/s1/stream");

    const composer = await screen.findByLabelText("Chat message");
    await user.type(composer, "hello attached");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url) === "/api/sessions/s1/messages" && init?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("starts a new standalone agent chat, streams a reply, and sends a message", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole("button", { name: "New chat" }));

    const source = await waitFor(() => {
      const s = lastSource;
      expect(s).not.toBeNull();
      return s!;
    });
    expect(source.url).toBe("/api/agent-chats/c1/stream");

    source.trigger({ id: 2, chatId: "c1", direction: "agent", text: "How can I help?" });
    expect(await screen.findByText("How can I help?")).toBeInTheDocument();

    const composer = await screen.findByLabelText("Chat message");
    await user.type(composer, "Refactor the auth flow");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/agent-chats/c1/messages" && init?.method === "POST",
        ),
      ).toBe(true);
    });
  });
  it("starts a run session and shows the streamed transcript", async () => {
    stubApi();
    const user = userEvent.setup();
    renderPane();

    await user.type(await screen.findByLabelText("Task id"), "t1");
    await user.type(await screen.findByLabelText("Repository path"), "/tmp/repo");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(await screen.findByText("hi")).toBeInTheDocument();
    const source = await waitFor(() => {
      const s = lastSource;
      expect(s).not.toBeNull();
      return s!;
    });

    source.trigger({ id: 2, type: "started", message: "Starting task" });
    expect(await screen.findByText(/Starting task/)).toBeInTheDocument();
  });

  it("sends a user message to the session channel", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderPane();

    await user.type(await screen.findByLabelText("Task id"), "t1");
    await user.type(await screen.findByLabelText("Repository path"), "/tmp/repo");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(lastSource).not.toBeNull());

    const composer = await screen.findByLabelText("Chat message");
    await user.type(composer, "Use the fast ORM");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url) === "/api/sessions/s1/messages" && init?.method === "POST",
        ),
      ).toBe(true);
    });
  });
});
