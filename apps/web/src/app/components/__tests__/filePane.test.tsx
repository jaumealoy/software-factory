import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "../filePane";
import { ProjectProvider } from "../../projectSwitcher";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value: string }) => (
    <textarea data-testid="monaco" value={value} readOnly />
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/projects") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "p1",
            name: "Alpha",
            slug: "alpha",
            description: null,
            defaultModel: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    }
    if (method === "GET" && url === "/api/projects/p1/files") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          exists: true,
          path: ".",
          entries: [
            { name: "src", path: "src", type: "dir", size: null },
            { name: "README.md", path: "README.md", type: "file", size: 12 },
          ],
        }),
      };
    }
    if (method === "GET" && url === "/api/projects/p1/files?path=src") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          exists: true,
          path: "src",
          entries: [{ name: "app.ts", path: "src/app.ts", type: "file", size: 20 }],
        }),
      };
    }
    if (method === "GET" && url === "/api/projects/p1/files/content?path=src%2Fapp.ts") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          path: "src/app.ts",
          content: "export const ok = true;",
          size: 20,
          binary: false,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: `no handler for ${url}` }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("project file pane (#25)", () => {
  it("lists the root tree and previews a file on expand", async () => {
    stubApi();
    const user = userEvent.setup();
    render(
      <ProjectProvider>
        <FilePane />
      </ProjectProvider>,
    );

    expect(await screen.findByText("Project files")).toBeInTheDocument();
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(await screen.findByText("src")).toBeInTheDocument();

    await user.click(screen.getByText("src"));
    expect(await screen.findByText("app.ts")).toBeInTheDocument();

    await user.click(screen.getByText("app.ts"));
    await waitFor(() => {
      const editor = screen.getByTestId("monaco") as HTMLTextAreaElement;
      expect(editor.value).toContain("export const ok = true");
    });
  });
});
