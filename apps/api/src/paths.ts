import path from "node:path";

/** apps/api — resolved robustly from source (dev) and dist (built). */
export const appRoot = path.resolve(import.meta.dirname, "..");

export const dataDir = path.join(appRoot, "data");
export const defaultDatabasePath = path.join(dataDir, "factory.db");
export const migrationsDir = path.join(appRoot, "drizzle");
export const webDistPath = path.resolve(appRoot, "../web/dist");
