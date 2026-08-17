import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { factoryMeta } from "../db/index.js";
import { ConfigurationError, ValidationError } from "./errors.js";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;
const KDF_SALT = "software-factory:settings:v1";

export const PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "deepseek",
  "openrouter",
  "kilo",
] as const;
export type Provider = (typeof PROVIDERS)[number];

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function masterKey(encryptionKey: string): Buffer {
  if (!encryptionKey) {
    throw new ConfigurationError(
      "FACTORY_ENCRYPTION_KEY is required for credential storage; refusing to operate unencrypted",
    );
  }
  return scryptSync(encryptionKey, KDF_SALT, 32);
}

/** Encrypts a secret for storage using AES-256-GCM. Returns a portable JSON envelope. */
export function encryptSecret(secret: string, encryptionKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, masterKey(encryptionKey), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  });
}

/** Decrypts a secret envelope. Throws ConfigurationError if the key changed or is missing. */
export function decryptSecret(payload: string, encryptionKey: string): string {
  const parsed = JSON.parse(payload) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(
    CIPHER,
    masterKey(encryptionKey),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  try {
    const data = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final(),
    ]);
    return data.toString("utf8");
  } catch {
    throw new ConfigurationError(
      "Unable to decrypt stored credential; the encryption key may have changed",
    );
  }
}

function credentialKey(provider: string): string {
  return `credential:${provider}`;
}

function maskSecret(secret: string): string {
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export interface ProviderCredentialView {
  provider: Provider;
  configured: boolean;
  masked: string | null;
}

export function setProviderCredential(
  db: Db,
  provider: string,
  secret: string,
  encryptionKey: string,
): ProviderCredentialView {
  if (!isProvider(provider)) {
    throw new ValidationError(`Unsupported provider "${provider}"`);
  }
  const key = (secret ?? "").trim();
  if (!key) {
    throw new ValidationError("Credential key must not be empty");
  }
  const encrypted = encryptSecret(key, encryptionKey);
  db.insert(factoryMeta)
    .values({ key: credentialKey(provider), value: encrypted })
    .onConflictDoUpdate({
      target: factoryMeta.key,
      set: { value: encrypted, updatedAt: new Date() },
    })
    .run();
  return { provider, configured: true, masked: maskSecret(key) };
}

export function removeProviderCredential(db: Db, provider: string): void {
  db.delete(factoryMeta)
    .where(eq(factoryMeta.key, credentialKey(provider)))
    .run();
}

export function getProviderCredential(
  db: Db,
  provider: string,
  encryptionKey: string,
): string | null {
  const row = db
    .select()
    .from(factoryMeta)
    .where(eq(factoryMeta.key, credentialKey(provider)))
    .get();
  return row ? decryptSecret(row.value, encryptionKey) : null;
}

export function listProviderCredentials(db: Db, encryptionKey: string): ProviderCredentialView[] {
  const rows = db.select().from(factoryMeta).all();
  const byProvider = new Map(rows.map((row) => [row.key, row.value]));
  return PROVIDERS.map((provider) => {
    const encrypted = byProvider.get(credentialKey(provider));
    if (!encrypted) {
      return { provider, configured: false, masked: null };
    }
    const secret = decryptSecret(encrypted, encryptionKey);
    return { provider, configured: true, masked: maskSecret(secret) };
  });
}
