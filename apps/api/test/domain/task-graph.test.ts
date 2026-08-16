import { describe, expect, it } from "vitest";
import type { Task } from "../../src/db/index.js";
import {
  CyclicDependencyError,
  DuplicateError,
  NotFoundError,
  ValidationError,
} from "../../src/domain/errors.js";
import {
  createTestChange,
  createTestContext,
  createTestProject,
  type TestContext,
} from "../helpers.js";

type ChangeContext = TestContext & { changeId: string };

async function setup(): Promise<ChangeContext> {
  const context = createTestContext();
  const { projectId } = await createTestProject(context.store);
  const { changeId } = await createTestChange(context.store, projectId);
  return { ...context, changeId };
}

async function createTasks(store: TestContext["store"], changeId: string, count: number) {
  const result: Awaited<ReturnType<TestContext["store"]["createTask"]>>[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(await store.createTask({ changeId, objective: `Task ${i + 1}` }));
  }
  return result;
}

describe("task dependency graph", () => {
  it("builds a layered DAG and reports it as acyclic", async () => {
    const { store, changeId } = await setup();
    const created = await createTasks(store, changeId, 4);
    const [contract, backend, frontend, tests] = created as [Task, Task, Task, Task];

    await store.addTaskDependency({ taskId: backend.id, dependsOnTaskId: contract.id });
    await store.addTaskDependency({ taskId: frontend.id, dependsOnTaskId: contract.id });
    await store.addTaskDependency({ taskId: tests.id, dependsOnTaskId: backend.id });
    await store.addTaskDependency({ taskId: tests.id, dependsOnTaskId: frontend.id });

    const graph = await store.getTaskGraph(changeId);
    expect(graph.tasks).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.isAcyclic).toBe(true);
  });

  it("rejects a dependency cycle", async () => {
    const { store, changeId } = await setup();
    const [a, b, c] = (await createTasks(store, changeId, 3)) as [Task, Task, Task];

    await store.addTaskDependency({ taskId: b.id, dependsOnTaskId: a.id });
    await store.addTaskDependency({ taskId: c.id, dependsOnTaskId: b.id });

    await expect(
      store.addTaskDependency({ taskId: a.id, dependsOnTaskId: c.id }),
    ).rejects.toBeInstanceOf(CyclicDependencyError);
  });

  it("rejects a direct self-dependency", async () => {
    const { store, changeId } = await setup();
    const [task] = (await createTasks(store, changeId, 1)) as [Task];

    await expect(
      store.addTaskDependency({ taskId: task.id, dependsOnTaskId: task.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects dependencies on tasks in another change", async () => {
    const { store, changeId } = await setup();
    const secondChange = await store.createChange({
      projectId: (await store.getChange(changeId)).projectId,
      title: "Second change",
      requestText: "Independent.",
    });

    const [task] = (await createTasks(store, changeId, 2)) as [Task, Task];
    const other = await store.createTask({
      changeId: secondChange.id,
      objective: "Foreign task",
    });

    await expect(
      store.addTaskDependency({ taskId: task.id, dependsOnTaskId: other.id }),
    ).rejects.toBeInstanceOf(ValidationError);

    const graph = await store.getTaskGraph(changeId);
    expect(graph).toBeDefined();
  });

  it("rejects unknown tasks and duplicate dependencies", async () => {
    const { store, changeId } = await setup();
    const [taskA, taskB] = (await createTasks(store, changeId, 2)) as [Task, Task];

    await expect(
      store.addTaskDependency({ taskId: taskA.id, dependsOnTaskId: "missing" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await store.addTaskDependency({ taskId: taskA.id, dependsOnTaskId: taskB.id });
    await expect(
      store.addTaskDependency({ taskId: taskA.id, dependsOnTaskId: taskB.id }),
    ).rejects.toBeInstanceOf(DuplicateError);
  });

  it("can remove a dependency and keeps the graph acyclic", async () => {
    const { store, changeId } = await setup();
    const [a, b, c] = (await createTasks(store, changeId, 3)) as [Task, Task, Task];

    await store.addTaskDependency({ taskId: b.id, dependsOnTaskId: a.id });
    await store.addTaskDependency({ taskId: c.id, dependsOnTaskId: b.id });

    await store.removeTaskDependency({ taskId: c.id, dependsOnTaskId: b.id });
    const graph = await store.getTaskGraph(changeId);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ taskId: b.id, dependsOnTaskId: a.id });
    expect(graph.isAcyclic).toBe(true);

    await expect(
      store.removeTaskDependency({ taskId: c.id, dependsOnTaskId: b.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
