import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPane } from "../editorPane";

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
});

function stubSave() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as { path?: string }) : undefined;
    if (method === "PUT" && url === "/api/projects/p1/files" && body?.path === "src/app.ts") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          path: "src/app.ts",
          content: "export const edited = true;",
          size: 29,
          binary: false,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "no handler" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("monaco editor pane (#32)", () => {
  it("saves edited content to the working tree", async () => {
    const fetchMock = stubSave();
    const user = userEvent.setup();
    render(
      <EditorPane projectId="p1" filePath="src/app.ts" initialValue="export const ok = true;" />,
    );

    const editor = screen.getByTestId("monaco");
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();

    await user.clear(editor);
    await user.type(editor, "export const edited = true;");
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
