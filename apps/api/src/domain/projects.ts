import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  factoryProjects,
  repositories,
  type FactoryProject,
  type Repository,
} from "../db/index.js";
import type { Db } from "../db/index.js";
import { DuplicateError, NotFoundError, ValidationError } from "./errors.js";
import { recordEvent } from "./events.js";

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
}

export interface AddRepositoryInput {
  projectId: string;
  name: string;
  url: string;
  localPath?: string;
  isPrimary?: boolean;
}

export interface ProjectWithRepositories {
  project: FactoryProject;
  repositories: Repository[];
}

export function normalizeSlug(slug: string): string {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new ValidationError(`Invalid slug: "${slug}"`);
  }
  return normalized;
}

export function createProject(db: Db, input: CreateProjectInput): FactoryProject {
  const slug = normalizeSlug(input.slug);
  const existing = db.select().from(factoryProjects).where(eq(factoryProjects.slug, slug)).get();
  if (existing) {
    throw new DuplicateError(`Project with slug "${slug}" already exists`);
  }

  const project = db
    .insert(factoryProjects)
    .values({
      id: randomUUID(),
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || undefined,
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "project",
    entityId: project.id,
    eventType: "project.created",
    payload: { name: project.name, slug: project.slug },
  });
  return project;
}

export function getProject(db: Db, projectId: string): FactoryProject {
  const project = db.select().from(factoryProjects).where(eq(factoryProjects.id, projectId)).get();
  if (!project) {
    throw new NotFoundError("project", projectId);
  }
  return project;
}

export function listProjects(db: Db): FactoryProject[] {
  return db.select().from(factoryProjects).orderBy(asc(factoryProjects.slug)).all();
}

export function addRepository(db: Db, input: AddRepositoryInput): Repository {
  getProject(db, input.projectId);

  if (!input.name.trim() || !input.url.trim()) {
    throw new ValidationError("Repository name and url are required");
  }

  const repository = db
    .insert(repositories)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name.trim(),
      url: input.url.trim(),
      localPath: input.localPath?.trim() || undefined,
      isPrimary: input.isPrimary ?? false,
    })
    .returning()
    .get();

  recordEvent(db, {
    entityType: "project",
    entityId: input.projectId,
    eventType: "repository.added",
    payload: { name: repository.name, url: repository.url, isPrimary: repository.isPrimary },
  });
  return repository;
}

export function getProjectWithRepositories(db: Db, projectId: string): ProjectWithRepositories {
  const project = getProject(db, projectId);
  const projectRepositories = db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .orderBy(asc(repositories.name))
    .all();
  return { project, repositories: projectRepositories };
}
