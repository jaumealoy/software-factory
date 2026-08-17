import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { repositories } from "../db/index.js";
import { getProject } from "./projects.js";
import { DuplicateError, NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";

export interface WorkFolder {
  id: string;
  name: string;
  path: string;
  url: string;
  isPrimary: boolean;
  exists: boolean;
}

function toFolder(row: {
  id: string;
  name: string;
  url: string;
  localPath: string | null;
  isPrimary: boolean;
}): WorkFolder {
  const path = row.localPath ?? "";
  return {
    id: row.id,
    name: row.name,
    path,
    url: row.url,
    isPrimary: row.isPrimary,
    exists: path ? existsSync(path) : false,
  };
}

export function listFolders(db: Db, projectId: string): WorkFolder[] {
  getProject(db, projectId);
  return db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .orderBy(asc(repositories.name))
    .all()
    .map((row) => toFolder(row));
}

export function addFolder(
  db: Db,
  projectId: string,
  input: { name: string; path: string },
): WorkFolder {
  getProject(db, projectId);
  const name = input.name?.trim();
  const path = input.path?.trim();
  if (!name) {
    throw new ValidationError("Folder name is required");
  }
  if (!path) {
    throw new ValidationError("Folder path is required");
  }
  const existing = db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .all();
  if (existing.some((folder) => (folder.localPath ?? "") === path)) {
    throw new DuplicateError(`A folder for "${path}" already exists on this project`);
  }
  const row = db
    .insert(repositories)
    .values({
      id: randomUUID(),
      projectId,
      name,
      url: "",
      localPath: path,
      isPrimary: existing.length === 0,
    })
    .returning()
    .get();
  recordEvent(db, {
    entityType: "project",
    entityId: projectId,
    eventType: "project.folder_added",
    payload: { folderId: row.id, name, path },
  });
  return toFolder(row);
}

/** Marks a folder as the active (primary) one for a project. */
export function setActiveFolder(db: Db, projectId: string, folderId: string): WorkFolder[] {
  const projectRepos = db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .all();
  if (projectRepos.length === 0) {
    throw new NotFoundError("folder", folderId);
  }
  const target = projectRepos.find((folder) => folder.id === folderId);
  if (!target) {
    throw new NotFoundError("folder", folderId);
  }
  for (const folder of projectRepos) {
    db.update(repositories)
      .set({ isPrimary: folder.id === folderId, updatedAt: new Date() })
      .where(eq(repositories.id, folder.id))
      .run();
  }
  recordEvent(db, {
    entityType: "project",
    entityId: projectId,
    eventType: "project.folder_active_changed",
    payload: { folderId, name: target.name },
  });
  return listFolders(db, projectId);
}

export function removeFolder(db: Db, projectId: string, folderId: string): WorkFolder[] {
  getProject(db, projectId);
  const target = db.select().from(repositories).where(eq(repositories.id, folderId)).get();
  if (!target || target.projectId !== projectId) {
    throw new NotFoundError("folder", folderId);
  }
  db.delete(repositories).where(eq(repositories.id, folderId)).run();
  const remaining = db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .all();
  if (target.isPrimary && remaining.length > 0) {
    const next = remaining[0]!;
    db.update(repositories)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(repositories.id, next.id))
      .run();
  }
  return listFolders(db, projectId);
}
