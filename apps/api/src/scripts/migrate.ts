import { createDb, runMigrations } from "../db/index.js";
import { loadConfig } from "../config.js";
import { migrationsDir } from "../paths.js";

const config = loadConfig();
const handle = createDb(config.DATABASE_PATH);
runMigrations(handle.db, migrationsDir);
handle.client.close();

console.log(`Migrations applied to ${config.DATABASE_PATH}`);
