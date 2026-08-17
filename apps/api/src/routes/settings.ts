import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import {
  listProviderCredentials,
  removeProviderCredential,
  setProviderCredential,
} from "../domain/settings.js";
import { ConfigurationError, ValidationError } from "../domain/errors.js";

export interface SettingsRoutesOptions {
  db: Db;
  /** AES-256-GCM key. When absent, credential endpoints fail closed. */
  encryptionKey?: string;
}

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  fastify,
  options,
) => {
  const { db, encryptionKey } = options;

  fastify.get("/api/settings/providers", async (_request, reply) => {
    if (!encryptionKey) {
      return reply.code(503).send({
        error:
          "Encryption is not configured (FACTORY_ENCRYPTION_KEY); credential storage is disabled",
      });
    }
    try {
      return { providers: listProviderCredentials(db, encryptionKey) };
    } catch (error) {
      if (error instanceof ConfigurationError) {
        return reply.code(503).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.put<{ Params: { provider: string }; Body: { key?: string } }>(
    "/api/settings/providers/:provider",
    async (request, reply) => {
      if (!encryptionKey) {
        return reply.code(503).send({
          error:
            "Encryption is not configured (FACTORY_ENCRYPTION_KEY); credential storage is disabled",
        });
      }
      try {
        const view = setProviderCredential(
          db,
          request.params.provider,
          request.body?.key ?? "",
          encryptionKey,
        );
        return view;
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        if (error instanceof ConfigurationError) {
          return reply.code(503).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  fastify.delete<{ Params: { provider: string } }>(
    "/api/settings/providers/:provider",
    async (request, reply) => {
      removeProviderCredential(db, request.params.provider);
      return reply.code(204).send();
    },
  );
};
