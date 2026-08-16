import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { capabilities, taskDependencies, tasks, type Task } from "../db/index.js";
import type { Db } from "../db/index.js";
import {
  CyclicDependencyError,
  DuplicateError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import { recordEvent } from "./events.js";
import { canTransitionTask, type RiskLevel, type TaskStatus } from "./statuses.js";
import { getChange } from "./changes.js";

export interface CreateTaskInput {
  changeId: string;
  capabilityId?: string;
  objective: string;
  scope?: string;
  risk?: RiskLevel;
}

export function createTask(db: Db, input: CreateTaskInput): Task {
  getChange(db, input.changeId);

  if (!input.objective.trim()) {
    throw new ValidationError("Task objective is required");
  }
  if (input.capabilityId) {
    const capability = db
      .select()
      .from(capabilities)
      .where(eq(capabilities.id, input.capabilityId))
      .get();
    if (!capability) {
      throw new NotFoundError("capability", input.capabilityId);
    }
    if (capability.changeId !== input.changeId) {
      throw new ValidationError("Capability must belong to the same change as the task");
    }
  }

  const task = db
    .insert(tasks)
    .values({
      id: randomUUID(),
      changeId: input.changeId,
      capabilityId: input.capabilityId,
      objective: input.objective.trim(),
      scope: input.scope?.trim() || undefined,
      risk: input.risk ?? "low",
      status: "PROPOSED",
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "task",
    entityId: task.id,
    eventType: "task.created",
    payload: { changeId: input.changeId, objective: task.objective },
  });
  return task;
}

export function getTask(db: Db, taskId: string): Task {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    throw new NotFoundError("task", taskId);
  }
  return task;
}

export function listTasks(db: Db, changeId: string): Task[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.changeId, changeId))
    .orderBy(asc(tasks.createdAt))
    .all();
}

export function transitionTask(db: Db, taskId: string, to: TaskStatus): Task {
  const task = getTask(db, taskId);
  if (!canTransitionTask(task.status, to)) {
    throw new InvalidTransitionError("task", task.status, to);
  }

  const updated = db
    .update(tasks)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning()
    .get();

  recordEvent(db, {
    entityType: "task",
    entityId: taskId,
    eventType: "task.status_changed",
    payload: { from: task.status, to },
  });
  return updated;
}

export interface SetGitHubReferenceInput {
  taskId: string;
  githubIssueNumber: number;
  githubIssueUrl: string;
}

export function setGitHubReference(db: Db, input: SetGitHubReferenceInput): Task {
  getTask(db, input.taskId);
  const updated = db
    .update(tasks)
    .set({
      githubIssueNumber: input.githubIssueNumber,
      githubIssueUrl: input.githubIssueUrl,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId))
    .returning()
    .get();

  recordEvent(db, {
    entityType: "task",
    entityId: input.taskId,
    eventType: "task.github_reference_set",
    payload: { issueNumber: input.githubIssueNumber, issueUrl: input.githubIssueUrl },
  });
  return updated;
}

export interface AddTaskDependencyInput {
  taskId: string;
  dependsOnTaskId: string;
}

export function addTaskDependency(db: Db, input: AddTaskDependencyInput): void {
  const task = getTask(db, input.taskId);
  const dependency = getTask(db, input.dependsOnTaskId);

  if (task.id === dependency.id) {
    throw new ValidationError("A task cannot depend on itself");
  }
  if (task.changeId !== dependency.changeId) {
    throw new ValidationError("Tasks can only depend on tasks within the same change");
  }

  const existing = db
    .select()
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, input.taskId),
        eq(taskDependencies.dependsOnTaskId, input.dependsOnTaskId),
      ),
    )
    .get();
  if (existing) {
    throw new DuplicateError("Task dependency already exists");
  }

  if (createsCycle(db, input.taskId, input.dependsOnTaskId)) {
    throw new CyclicDependencyError(input.taskId, input.dependsOnTaskId);
  }

  db.insert(taskDependencies)
    .values({ taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId })
    .run();

  recordEvent(db, {
    entityType: "task",
    entityId: input.taskId,
    eventType: "task.dependency_added",
    payload: { dependsOnTaskId: input.dependsOnTaskId },
  });
}

export interface RemoveTaskDependencyInput {
  taskId: string;
  dependsOnTaskId: string;
}

export function removeTaskDependency(db: Db, input: RemoveTaskDependencyInput): void {
  const removed = db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, input.taskId),
        eq(taskDependencies.dependsOnTaskId, input.dependsOnTaskId),
      ),
    )
    .run();
  if (removed.changes === 0) {
    throw new NotFoundError("task dependency", `${input.taskId} -> ${input.dependsOnTaskId}`);
  }

  recordEvent(db, {
    entityType: "task",
    entityId: input.taskId,
    eventType: "task.dependency_removed",
    payload: { dependsOnTaskId: input.dependsOnTaskId },
  });
}

export interface TaskGraph {
  tasks: Task[];
  edges: { taskId: string; dependsOnTaskId: string }[];
  isAcyclic: boolean;
}

export function getTaskGraph(db: Db, changeId: string): TaskGraph {
  const changeTasks = listTasks(db, changeId);
  const taskIds = changeTasks.map((task) => task.id);

  const dependencyRows =
    taskIds.length === 0
      ? []
      : db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, taskIds)).all();

  const edges = dependencyRows.map((row) => ({
    taskId: row.taskId,
    dependsOnTaskId: row.dependsOnTaskId,
  }));
  return { tasks: changeTasks, edges, isAcyclic: !hasCycle(changeTasks, edges) };
}

function createsCycle(db: Db, taskId: string, dependsOnTaskId: string): boolean {
  const dependencyTargets = (nodeId: string): string[] =>
    db
      .select({ dependsOnTaskId: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, nodeId))
      .all()
      .map((row) => row.dependsOnTaskId);

  const visited = new Set<string>();
  const stack = [dependsOnTaskId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const target of dependencyTargets(current)) {
      stack.push(target);
    }
  }
  return false;
}

function hasCycle(changeTasks: Task[], edges: TaskGraph["edges"]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const task of changeTasks) {
    adjacency.set(task.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.taskId)?.push(edge.dependsOnTaskId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of adjacency.keys()) {
    if (visit(node)) return true;
  }
  return false;
}
