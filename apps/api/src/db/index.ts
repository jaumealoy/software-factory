import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrationsDir } from "../paths.js";
import * as schema from "./schema.js";

export * from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  client: Database.Database;
  db: Db;
}

export function createDb(databasePath: string): DbHandle {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const client = new Database(databasePath);
  if (databasePath !== ":memory:") {
    client.pragma("journal_mode = WAL");
  }
  client.pragma("foreign_keys = ON");
  const db = drizzle(client, { schema });
  return { client, db };
}

export function runMigrations(db: Db, folder: string = migrationsDir): void {
  migrate(db, { migrationsFolder: folder });
}
