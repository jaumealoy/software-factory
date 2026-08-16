import { createDb, runMigrations, type DbHandle } from "../src/db/index.js";
import { FactoryStore } from "../src/domain/index.js";
import { migrationsDir } from "../src/paths.js";

export interface TestContext {
  handle: DbHandle;
  store: FactoryStore;
  db: DbHandle["db"];
}

export function createTestContext(): TestContext {
  const handle = createDb(":memory:");
  runMigrations(handle.db, migrationsDir);
  return { handle, store: new FactoryStore(handle.db), db: handle.db };
}

export async function createTestProject(store: FactoryStore): Promise<{ projectId: string }> {
  const project = await store.createProject({
    name: "Test Project",
    slug: `test-project-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { projectId: project.id };
}

export async function createTestChange(
  store: FactoryStore,
  projectId: string,
): Promise<{ changeId: string }> {
  const change = await store.createChange({
    projectId,
    title: "Test change",
    requestText: "Implement the test behavior.",
  });
  return { changeId: change.id };
}
