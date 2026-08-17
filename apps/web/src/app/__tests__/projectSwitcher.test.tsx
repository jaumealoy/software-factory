import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "../pages/home";
import { ProjectProvider } from "../projectSwitcher";
import type { Project } from "../../api";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    defaultModel: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const projects: Project[] = [makeProject("p1", "Alpha"), makeProject("p2", "Beta")];

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/projects") {
      return { ok: true, status: 200, json: async () => projects };
    }
    if (method === "GET" && url.startsWith("/api/changes")) {
      return { ok: true, status: 200, json: async () => [] };
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

describe("project switcher (#27)", () => {
  it("persists the active project and scopes the changes query", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(
      <ProjectProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </ProjectProvider>,
    );

    const trigger = await screen.findByLabelText("Project");
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(await screen.findByText("Beta"));

    await waitFor(() => {
      expect(localStorage.getItem("factory.activeProjectId")).toBe("p2");
    });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === "/api/changes?projectId=p2"),
      ).toBe(true);
    });
  });
});
