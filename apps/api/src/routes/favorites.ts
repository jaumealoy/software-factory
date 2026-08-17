import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/index.js";
import { addFavoriteModel, listFavoriteModels, removeFavoriteModel } from "../domain/favorites.js";

export interface FavoritesRoutesOptions {
  db: Db;
}

interface FavoritesBody {
  model?: string;
}

export const favoritesRoutes: FastifyPluginAsync<FavoritesRoutesOptions> = async (
  fastify,
  options,
) => {
  const { db } = options;

  fastify.get("/api/favorites", async () => {
    return { models: listFavoriteModels(db) };
  });

  fastify.put<{ Body: FavoritesBody }>("/api/favorites", async (request) => {
    const models = addFavoriteModel(db, request.body?.model ?? "");
    return { model: models, models: listFavoriteModels(db) };
  });

  fastify.delete<{ Body: FavoritesBody }>("/api/favorites", async (request, reply) => {
    removeFavoriteModel(db, request.body?.model ?? "");
    return reply.code(204).send();
  });
};
