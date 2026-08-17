import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffPane } from "../diffPane";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDiff() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/projects/p1/diff") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          diff: {
            empty: false,
            files: [
              {
                path: "src/app.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                hunks: [
                  {
                    header: "@@ -1 +1 @@",
                    lines: [
                      { type: "del", text: "old line" },
                      { type: "add", text: "new line" },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: "no handler" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("git diff view (#33)", () => {
  it("renders a modified file with its hunks", async () => {
    stubDiff();
    const user = userEvent.setup();
    render(<DiffPane projectId="p1" />);

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();

    await user.click(screen.getByText("src/app.ts"));
    expect(await screen.findByText(/old line/)).toBeInTheDocument();
    expect(await screen.findByText(/new line/)).toBeInTheDocument();
  });
});
