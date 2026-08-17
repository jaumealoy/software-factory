import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_MODEL,
  resolveTaskModel,
  setProjectDefaultModel,
  setTaskModel,
} from "../../src/domain/models.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";

describe("model resolution", () => {
  it("falls back to the global default when nothing is configured", async () => {
    const { store } = createTestContext();
    const { projectId } = await createTestProject(store);
    const { changeId } = await createTestChange(store, projectId);
    const task = await store.createTask({ changeId, objective: "x" });

    const resolution = resolveTaskModel(store.db, task.id);
    expect(resolution.model).toBe(DEFAULT_TASK_MODEL);
    expect(resolution.source).toBe("default");
  });

  it("prefers the project default over the global default", async () => {
    const { store } = createTestContext();
    const project = await store.createProject({
      name: "P",
      slug: `p-${Math.random().toString(36).slice(2)}`,
    });
    setProjectDefaultModel(store.db, project.id, "kilo/anthropic/claude-sonnet-4.5");
    const change = await store.createChange({
      projectId: project.id,
      title: "Add",
      requestText: "x",
    });
    const task = await store.createTask({ changeId: change.id, objective: "x" });

    const resolution = resolveTaskModel(store.db, task.id);
    expect(resolution.model).toBe("kilo/anthropic/claude-sonnet-4.5");
    expect(resolution.source).toBe("project");
  });

  it("prefers the per-task model over the project default and clears it", async () => {
    const { store } = createTestContext();
    const project = await store.createProject({
      name: "P",
      slug: `p-${Math.random().toString(36).slice(2)}`,
    });
    setProjectDefaultModel(store.db, project.id, "kilo/anthropic/claude-sonnet-4.5");
    const change = await store.createChange({
      projectId: project.id,
      title: "Add",
      requestText: "x",
    });
    const task = await store.createTask({ changeId: change.id, objective: "x" });

    setTaskModel(store.db, task.id, "kilo/openai/gpt-5");
    expect(resolveTaskModel(store.db, task.id)).toEqual({
      model: "kilo/openai/gpt-5",
      source: "task",
    });

    setTaskModel(store.db, task.id, null);
    expect(resolveTaskModel(store.db, task.id).source).toBe("project");
  });
});
