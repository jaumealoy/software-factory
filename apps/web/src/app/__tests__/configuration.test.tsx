import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationPage } from "../pages/configuration";
import { ProjectProvider } from "../projectSwitcher";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function renderConfig() {
  return render(
    <ProjectProvider>
      <ConfigurationPage />
    </ProjectProvider>,
  );
}

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });
    if (method === "GET" && url === "/api/projects") {
      return json([
        {
          id: "p1",
          name: "Alpha",
          slug: "alpha",
          description: null,
          defaultModel: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    }
    if (method === "GET" && url === "/api/projects/p1/folders") {
      return json({
        folders: [
          {
            id: "f1",
            name: "Backend",
            path: "/repos/backend",
            url: "",
            isPrimary: true,
            exists: true,
          },
        ],
      });
    }
    if (method === "POST" && url === "/api/projects/p1/folders") {
      return json(
        {
          folder: {
            id: "f2",
            name: "Web",
            path: "/repos/web",
            url: "",
            isPrimary: false,
            exists: true,
          },
        },
        201,
      );
    }
    if (method === "PATCH" && url === "/api/projects/p1/folders/f2") {
      return json({
        folders: [
          {
            id: "f1",
            name: "Backend",
            path: "/repos/backend",
            url: "",
            isPrimary: false,
            exists: true,
          },
          { id: "f2", name: "Web", path: "/repos/web", url: "", isPrimary: true, exists: true },
        ],
      });
    }
    if (method === "GET" && url === "/api/settings/providers") {
      return json({
        providers: [
          { provider: "anthropic", configured: true, masked: "••••0001" },
          { provider: "openai", configured: false, masked: null },
        ],
      });
    }
    if (method === "GET" && url === "/api/models") {
      return json({
        models: [
          { id: "anthropic/claude-sonnet-4.5", provider: "anthropic", model: "claude-sonnet-4.5" },
          { id: "openai/gpt-4o", provider: "openai", model: "gpt-4o" },
        ],
      });
    }
    if (method === "GET" && url === "/api/favorites") {
      return json({ models: ["anthropic/claude-sonnet-4.5"] });
    }
    if (method === "PUT" && url === "/api/settings/providers/openai") {
      return json({ provider: "openai", configured: true, masked: "••••abcd" });
    }
    if (method === "PUT" && url === "/api/favorites") {
      return json({
        model: "openai/gpt-4o",
        models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
      });
    }
    if (method === "DELETE" && url === "/api/favorites") {
      return { ok: true, status: 204, json: async () => null };
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

describe("factory configuration (#31)", () => {
  it("lists providers with masked handles and favorite models", async () => {
    stubApi();
    renderConfig();

    expect((await screen.findAllByText("anthropic")).length).toBeGreaterThan(0);
    expect(await screen.findByText("••••0001")).toBeInTheDocument();
    expect(await screen.findByText("claude-sonnet-4.5")).toBeInTheDocument();
    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
  });

  it("stars a model via the favorites API", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderConfig();

    const addFav = await screen.findByRole("button", { name: "Add to favorites" });
    await user.click(addFav);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url) === "/api/favorites" && init?.method === "PUT",
        ),
      ).toBe(true);
    });
  });

  it("saves a provider key via the settings API", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderConfig();

    const input = await screen.findByLabelText("openai");
    await user.type(input, "sk-openai-xyz");
    await user.click(screen.getByRole("button", { name: "Save key for openai" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/settings/providers/openai" && init?.method === "PUT",
        ),
      ).toBe(true);
    });
  });

  it("adds a folder and marks it active (#40)", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderConfig();

    expect(await screen.findByText("Backend")).toBeInTheDocument();

    await user.type(await screen.findByLabelText("Add a folder"), "Web");
    await user.type(await screen.findByPlaceholderText("/absolute/path"), "/repos/web");
    await user.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url) === "/api/projects/p1/folders" && init?.method === "POST",
        ),
      ).toBe(true);
    });

    const setActive = await screen.findByRole("button", { name: /Set active/ });
    await user.click(setActive);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/projects/p1/folders/f2" && init?.method === "PATCH",
        ),
      ).toBe(true);
    });
  });
});
