import { z } from "zod";
import { defaultDatabasePath } from "./paths.js";
import dotenv from "dotenv";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().min(1).default(defaultDatabasePath),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /**
   * Required to enable encrypted provider credential storage (AES-256-GCM).
   * Credential endpoints fail closed when this is not configured.
   */
  FACTORY_ENCRYPTION_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  dotenv.config();
  return configSchema.parse(env);
}
