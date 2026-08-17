import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationPage } from "../pages/configuration";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
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
    render(<ConfigurationPage />);

    expect((await screen.findAllByText("anthropic")).length).toBeGreaterThan(0);
    expect(await screen.findByText("••••0001")).toBeInTheDocument();
    expect(await screen.findByText("claude-sonnet-4.5")).toBeInTheDocument();
    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
  });

  it("stars a model via the favorites API", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<ConfigurationPage />);

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
    render(<ConfigurationPage />);

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
});
