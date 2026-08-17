import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { repositories } from "../db/index.js";

/** Resolves the repository root for a project (primary repository localPath, else first). */
export function defaultRootResolver(db: Db) {
  return (projectId: string): string | null => {
    const projectRepos = db
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, projectId))
      .all();
    const repo = projectRepos.find((candidate) => candidate.isPrimary) ?? projectRepos[0];
    return repo?.localPath || null;
  };
}
