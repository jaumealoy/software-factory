import type { FastifyPluginAsync } from "fastify";
import { KiloNotInstalledError } from "../kilo/client.js";
import { listAvailableModels, type KiloModel } from "../kilo/models.js";

export interface ModelsRoutesOptions {
  /** Injectable model lister (defaults to the real `kilo models`). */
  modelsRunner?: () => Promise<string>;
}

export const modelsRoutes: FastifyPluginAsync<ModelsRoutesOptions> = async (fastify, options) => {
  fastify.get("/api/models", async (_request, reply) => {
    try {
      const models: KiloModel[] = await listAvailableModels(options.modelsRunner);
      return { models };
    } catch (error) {
      if (error instanceof KiloNotInstalledError) {
        return reply.code(503).send({ error: error.message });
      }
      throw error;
    }
  });
};
