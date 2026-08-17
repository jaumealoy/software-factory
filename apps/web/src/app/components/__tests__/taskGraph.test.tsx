import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { computeLayers, TaskGraphView } from "../taskGraph";
import type { TaskItem } from "../../../api";

function task(id: string, objective: string, status = "READY"): TaskItem {
  return {
    id,
    changeId: "c1",
    capabilityId: null,
    objective,
    scope: null,
    status,
    risk: "low",
    githubIssueNumber: null,
    githubIssueUrl: null,
  };
}

describe("TaskGraphView", () => {
  it("renders an empty state", () => {
    render(<TaskGraphView tasks={[]} edges={[]} isAcyclic />);
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });

  it("renders the graph summary, cards, and dependency list", async () => {
    const contract = task("t1", "Define the contract.");
    const backend = task("t2", "Implement backend.");
    const frontend = task("t3", "Implement frontend.");
    const tests = task("t4", "Acceptance tests.", "DONE");
    const tasks = [contract, backend, frontend, tests];
    const edges = [
      { taskId: "t2", dependsOnTaskId: "t1" },
      { taskId: "t3", dependsOnTaskId: "t1" },
      { taskId: "t4", dependsOnTaskId: "t2" },
      { taskId: "t4", dependsOnTaskId: "t3" },
    ];

    render(<TaskGraphView tasks={tasks} edges={edges} isAcyclic />);

    expect(screen.getByText("4 tasks, 4 dependencies — acyclic")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Task dependency graph" })).toBeInTheDocument();

    expect(screen.getAllByText("Implement backend.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Acceptance tests.").length).toBeGreaterThan(0);

    const dependencyItem = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("depends on"));
    expect(dependencyItem?.textContent).toContain("Define the contract.");
  });

  it("computes a longest-path layering", () => {
    const tasks = [task("t1", "a"), task("t2", "b"), task("t3", "c"), task("t4", "d")];
    const edges = [
      { taskId: "t2", dependsOnTaskId: "t1" },
      { taskId: "t3", dependsOnTaskId: "t1" },
      { taskId: "t4", dependsOnTaskId: "t2" },
      { taskId: "t4", dependsOnTaskId: "t3" },
    ];

    const layers = computeLayers(tasks, edges);
    expect(layers.get("t1")?.layer).toBe(0);
    expect(layers.get("t2")?.layer).toBe(1);
    expect(layers.get("t3")?.layer).toBe(1);
    expect(layers.get("t4")?.layer).toBe(2);
  });
});
