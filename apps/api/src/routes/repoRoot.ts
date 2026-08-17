import { eq, and } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { repositories } from "../db/index.js";

/**
 * Resolves a project's repository root.
 * - `folderId` given: resolves that folder's local path.
 * - otherwise: the active (primary) folder, else the first.
 */
export function defaultRootResolver(db: Db) {
  return (projectId: string, folderId?: string): string | null => {
    if (folderId) {
      const folder = db
        .select()
        .from(repositories)
        .where(and(eq(repositories.id, folderId), eq(repositories.projectId, projectId)))
        .get();
      if (!folder) {
        return null;
      }
      return folder.localPath || null;
    }
    const projectRepos = db
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, projectId))
      .all();
    const repo = projectRepos.find((candidate) => candidate.isPrimary) ?? projectRepos[0];
    return repo?.localPath || null;
  };
}
