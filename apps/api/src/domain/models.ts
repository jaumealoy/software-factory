import { eq } from "drizzle-orm";
import { factoryProjects, tasks, changes } from "../db/index.js";
import type { Db } from "../db/index.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { KiloModel } from "../kilo/models.js";

export const DEFAULT_TASK_MODEL = "kilo/anthropic/claude-haiku-4.5";

export type ModelSource = "task" | "project" | "default";

export interface ModelResolution {
  model: string;
  source: ModelSource;
}

export function setTaskModel(db: Db, taskId: string, model: string | null): void {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    throw new NotFoundError("task", taskId);
  }
  db.update(tasks)
    .set({ model: model?.trim() || null, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .run();
}

export function setProjectDefaultModel(db: Db, projectId: string, model: string | null): void {
  const project = db.select().from(factoryProjects).where(eq(factoryProjects.id, projectId)).get();
  if (!project) {
    throw new NotFoundError("project", projectId);
  }
  db.update(factoryProjects)
    .set({ defaultModel: model?.trim() || null, updatedAt: new Date() })
    .where(eq(factoryProjects.id, projectId))
    .run();
}

/** Resolves the model for a task: task preference > project default > global default. */
export function resolveTaskModel(db: Db, taskId: string): ModelResolution {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    throw new NotFoundError("task", taskId);
  }
  if (task.model) {
    return { model: task.model, source: "task" };
  }
  const change = db.select().from(changes).where(eq(changes.id, task.changeId)).get();
  const projectId = change?.projectId;
  const project = projectId
    ? db.select().from(factoryProjects).where(eq(factoryProjects.id, projectId)).get()
    : undefined;
  if (project?.defaultModel) {
    return { model: project.defaultModel, source: "project" };
  }
  return { model: DEFAULT_TASK_MODEL, source: "default" };
}

export function assertModelAvailable(model: string, available: KiloModel[]): void {
  if (!available.some((candidate) => candidate.id === model || candidate.model === model)) {
    throw new ValidationError(`Model "${model}" is not available on this Kilo installation`);
  }
}
