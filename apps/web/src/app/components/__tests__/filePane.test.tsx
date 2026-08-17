import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePane } from "../filePane";
import { EditorWorkspacePane } from "../editorWorkspacePane";
import { ProjectProvider } from "../../projectSwitcher";
import { EditorWorkspaceProvider } from "../../editorWorkspace";

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string | undefined) => void;
  }) => (
    <textarea data-testid="monaco" value={value} onChange={(e) => onChange?.(e.target.value)} />
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
    const body = init?.body ? (JSON.parse(String(init.body)) as { path?: string }) : undefined;
    const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
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
    if (method === "GET" && url === "/api/projects/p1/files") {
      return json({
        exists: true,
        path: ".",
        entries: [
          { name: "src", path: "src", type: "dir", size: null },
          { name: "README.md", path: "README.md", type: "file", size: 12 },
        ],
      });
    }
    if (method === "GET" && url === "/api/projects/p1/files?path=src") {
      return json({
        exists: true,
        path: "src",
        entries: [
          { name: "app.ts", path: "src/app.ts", type: "file", size: 20 },
          { name: "util.ts", path: "src/util.ts", type: "file", size: 20 },
        ],
      });
    }
    if (
      method === "GET" &&
      (url === "/api/projects/p1/files/content?path=src%2Fapp.ts" ||
        url === "/api/projects/p1/files/content?path=src%2Futil.ts")
    ) {
      const isUtil = url.includes("util.ts");
      return json({
        path: isUtil ? "src/util.ts" : "src/app.ts",
        content: isUtil ? "export const util = 1;" : "export const ok = true;",
        size: 20,
        binary: false,
      });
    }
    if (method === "PUT" && url === "/api/projects/p1/files" && body?.path === "src/app.ts") {
      return json({ path: "src/app.ts", content: "edited", size: 7, binary: false });
    }
    return { ok: false, status: 404, json: async () => ({ error: `no handler for ${url}` }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderWorkspace() {
  return render(
    <ProjectProvider>
      <EditorWorkspaceProvider>
        <div className="h-64 w-64">
          <FilePane />
        </div>
        <div className="h-64 w-64">
          <EditorWorkspacePane />
        </div>
      </EditorWorkspaceProvider>
    </ProjectProvider>,
  );
}

describe("editor workspace (#34)", () => {
  it("opens a file from the tree as a tab in the main-pane workspace", async () => {
    stubApi();
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    await user.click(screen.getByText("src"));
    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    await user.click(screen.getByText("app.ts"));

    await waitFor(() => {
      const editor = screen.getByTestId("monaco") as HTMLTextAreaElement;
      expect(editor.value).toContain("export const ok = true");
    });
    expect(screen.getByRole("tab", { name: /app.ts/ })).toBeInTheDocument();
  });

  it("opens multiple files as tabs and switches between them", async () => {
    stubApi();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText("src"));
    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    await user.click(screen.getByText("app.ts"));
    await user.click(await screen.findByText("util.ts"));

    await waitFor(() => {
      expect(screen.getAllByRole("tab")).toHaveLength(2);
    });
    await user.click(within(screen.getByRole("tablist")).getByRole("button", { name: "app.ts" }));
    await waitFor(() => {
      const editor = screen.getByTestId("monaco") as HTMLTextAreaElement;
      expect(editor.value).toContain("export const ok = true");
    });
  });

  it("marks a tab dirty on edit and saves to the working tree", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByText("src"));
    expect(await screen.findByText("app.ts")).toBeInTheDocument();
    await user.click(screen.getByText("app.ts"));
    await waitFor(() => {
      expect(screen.getByTestId("monaco")).toBeInTheDocument();
    });

    const editor = screen.getByTestId("monaco");
    await user.clear(editor);
    await user.type(editor, "export const edited = true;");
    expect(screen.getByRole("tab", { name: /app.ts/ })).toHaveTextContent("●");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url) === "/api/projects/p1/files" && init?.method === "PUT",
        ),
      ).toBe(true);
    });
  });
});
