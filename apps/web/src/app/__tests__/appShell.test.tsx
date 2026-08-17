import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../router";

function renderAt(url: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [url] });
  return render(<RouterProvider router={router} />);
}

describe("app shell (#24)", () => {
  it("renders the sidebar icon entries", () => {
    renderAt("/");
    expect(screen.getByLabelText("Primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Active project")).toBeInTheDocument();
    for (const label of [
      "Feature requests",
      "Changes",
      "Runs",
      "Project configuration",
      "Settings",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders resizable panes with resize handles", () => {
    renderAt("/");
    expect(screen.getByText("Project files")).toBeInTheDocument();
    expect(screen.getByText("Agent chat")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Resize pane").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the correct screen on a deep link", async () => {
    renderAt("/configuration");
    expect(await screen.findByText("Providers")).toBeInTheDocument();
  });
});
