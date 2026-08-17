import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRoutes } from "./app/router";
import type { ChangeDetail, Project } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

type Handler = () => unknown | Promise<unknown>;

function stubApi(handlers: Record<string, Handler>): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({ error: `no handler for ${key}` }) };
    }
    return { ok: true, status: 200, json: async () => handler() };
  });
  vi.stubGlobal("fetch", fetchMock);
}

const project: Project = {
  id: "p1",
  name: "Demo Factory Project",
  slug: "demo",
  description: null,
  defaultModel: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeDetail(overrides: Partial<ChangeDetail> = {}): ChangeDetail {
  return {
    change: {
      id: "c1",
      projectId: "p1",
      title: "Add Google OAuth",
      summary: null,
      requestText: "Users should be able to sign in with Google.",
      status: "DECOMPOSING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    capabilities: [{ id: "cap1", name: "Authentication", description: "Sign-in" }],
    tasks: [
      {
        id: "t1",
        changeId: "c1",
        capabilityId: "cap1",
        objective: "Define the auth contract.",
        scope: null,
        model: null,
        status: "READY",
        risk: "medium",
        githubIssueNumber: null,
        githubIssueUrl: null,
      },
    ],
    taskGraph: { tasks: [], edges: [], isAcyclic: true },
    pendingDecisions: [],
    artifacts: [],
    events: [],
    ...overrides,
  };
}

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(appRoutes, { initialEntries });
  return render(<RouterProvider router={router} />);
}

describe("dashboard routing", () => {
  it("submits a request on the home route and navigates to the change detail", async () => {
    stubApi({
      "GET /api/projects": () => [project],
      "GET /api/changes": () => [],
      "POST /api/changes": () => ({
        workflow: {
          changeId: "c1",
          phase: "completed",
          decisionId: null,
          tasksCreated: 1,
          capabilitiesCreated: 1,
          openspecName: "add-google-oauth",
          impactArtifactId: "a1",
        },
        pendingDecisions: [],
      }),
      "GET /api/changes/c1": () => makeDetail(),
    });

    renderRouter(["/"]);

    expect(await screen.findByText("Start a request")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Add Google OAuth login"), {
      target: { value: "Add Google OAuth login" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Describe the feature you want the factory to build."),
      { target: { value: "Users should be able to sign in with Google." } },
    );
    fireEvent.change(screen.getByPlaceholderText("/path/to/product/repo"), {
      target: { value: "/tmp/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run factory" }));

    expect((await screen.findAllByText("Define the auth contract.")).length).toBeGreaterThan(0);
    expect(screen.getByText("Add Google OAuth")).toBeInTheDocument();
    expect(screen.getByText("Task graph")).toBeInTheDocument();
    expect(screen.getByText(/task execution runs will appear here/i)).toBeInTheDocument();
  });

  it("renders a pending decision on a deep-linked change detail and resolves it", async () => {
    let detail = makeDetail({
      pendingDecisions: [
        {
          id: "dec1",
          changeId: "c1",
          problem: "Which OAuth library should we use?",
          optionsJson: '["openid-client", "passport"]',
          recommendation: "openid-client",
          rationale: "Smaller API surface.",
          status: "PENDING",
          resolutionNote: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    stubApi({
      "GET /api/changes/c1": () => detail,
      "POST /api/decisions/dec1/resolve": () => {
        detail = makeDetail();
        return {
          decision: { id: "dec1", status: "APPROVED" },
          workflow: { phase: "completed", changeId: "c1" },
          pendingDecisions: [],
        };
      },
    });

    renderRouter(["/changes/c1"]);

    expect(await screen.findByText("Decision needed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.queryByText("Decision needed")).not.toBeInTheDocument();
    });
  });

  it("navigates between sections and renders the not-found page", async () => {
    stubApi({
      "GET /api/projects": () => [project],
      "GET /api/changes": () => [{ ...makeDetail().change }],
    });

    const { unmount } = renderRouter(["/"]);

    fireEvent.click(await screen.findByRole("link", { name: "Changes" }));
    expect(await screen.findByLabelText("Changes list")).toBeInTheDocument();

    unmount();
    renderRouter(["/unknown/route"]);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
