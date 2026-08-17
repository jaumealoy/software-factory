import type { Db } from "../db/index.js";
import { ValidationError } from "../domain/errors.js";
import { getProviderCredential } from "../domain/settings.js";

/** Maps a cloud provider to the env var Kilo/the SDK expects for its API key. */
export const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * Extracts the provider from a model id, e.g. `kilo/anthropic/claude-…` -> `anthropic`
 * and `anthropic/claude-…` -> `anthropic`.
 */
export function providerOfModel(model: string): string | null {
  const parts = model.split("/");
  const provider = parts[0] === "kilo" ? parts[1] : parts[0];
  return provider || null;
}

/** The env var name Kilo uses to authenticate a provider, or null if none is required. */
export function envVarForProvider(provider: string): string | null {
  return PROVIDER_ENV_VAR[provider] ?? null;
}

/**
 * Builds the env map to inject for a model's provider, reading the stored credential.
 * - No `encryptionKey` -> returns null (no enforcement; Kilo may use its own auth).
 * - Provider needs no key (e.g. Kilo-local) -> returns null.
 * - Provider needs a key but none is configured -> throws a clear error.
 * Returns a single-entry map `{ ANTHROPIC_API_KEY: "..." }` to merge into the process env.
 */
export function buildKiloEnv(
  db: Db,
  model: string,
  encryptionKey: string | undefined,
): Record<string, string> | null {
  if (!encryptionKey) {
    return null;
  }
  const provider = providerOfModel(model);
  if (!provider) {
    return null;
  }
  const envVar = envVarForProvider(provider);
  if (!envVar) {
    return null;
  }
  const secret = getProviderCredential(db, provider, encryptionKey);
  if (!secret) {
    throw new ValidationError(
      `No API key configured for provider "${provider}"; add it in Factory Configuration (settings)`,
    );
  }
  return { [envVar]: secret };
}
