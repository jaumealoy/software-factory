import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskExecutionPanel } from "../taskExecution";
import type { TaskItem } from "../../../api";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = () => unknown | Promise<unknown>;

function stubApi(handlers: Record<string, Handler>): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const handler = handlers[key];
    if (!handler) return { ok: false, status: 404, json: async () => ({ error: "nope" }) };
    return { ok: true, status: 200, json: async () => handler() };
  });
  vi.stubGlobal("fetch", fetchMock);
}

function task(id: string, status = "READY"): TaskItem {
  return {
    id,
    changeId: "c1",
    capabilityId: null,
    objective: "Implement the widget.",
    scope: null,
    model: null,
    status,
    risk: "high",
    githubIssueNumber: null,
    githubIssueUrl: null,
  };
}

describe("TaskExecutionPanel", () => {
  it("lets the user pick a model per task", async () => {
    const user = userEvent.setup();
    stubApi({
      "GET /api/models": () => ({
        models: [
          {
            id: "kilo/anthropic/claude-haiku-4.5",
            provider: "anthropic",
            model: "claude-haiku-4.5",
          },
          { id: "kilo/openai/gpt-5", provider: "openai", model: "gpt-5" },
        ],
      }),
      "GET /api/tasks/t1/runs": () => ({ runs: [] }),
      "PATCH /api/tasks/t1/model": () => ({
        task: task("t1"),
        model: { model: "kilo/openai/gpt-5", source: "task" },
      }),
    });
    const onTaskUpdated = vi.fn();

    render(
      <TaskExecutionPanel
        tasks={[task("t1")]}
        repositoryPath="/tmp/repo"
        onTaskUpdated={onTaskUpdated}
      />,
    );

    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByText("gpt-5"));
    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalled());
  });

  it("renders run status and verification output after running", async () => {
    const user = userEvent.setup();
    stubApi({
      "GET /api/models": () => ({ models: [] }),
      "GET /api/tasks/t1/runs": () => ({ runs: [] }),
      "POST /api/tasks/t1/run": () => ({
        result: {
          status: "FAILED",
          message: "Verification failed",
          verificationPassed: false,
          verificationOutput: "AssertionError: expected 1 to be 2",
          events: [],
        },
      }),
    });

    render(
      <TaskExecutionPanel
        tasks={[task("t1")]}
        repositoryPath="/tmp/repo"
        onTaskUpdated={() => undefined}
      />,
    );

    const runButton = await screen.findByRole("button", { name: "Run" });
    await user.click(runButton);

    expect(await screen.findByText("FAILED")).toBeInTheDocument();
  });

  it("disables the run button when the task is not READY or no repository path", () => {
    stubApi({
      "GET /api/models": () => ({ models: [] }),
      "GET /api/tasks/t1/runs": () => ({ runs: [] }),
    });
    const { rerender } = render(
      <TaskExecutionPanel
        tasks={[task("t1", "DONE")]}
        repositoryPath="/tmp/repo"
        onTaskUpdated={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();

    rerender(
      <TaskExecutionPanel tasks={[task("t1")]} repositoryPath="" onTaskUpdated={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
