import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { modelFavorites } from "../db/index.js";

export function listFavoriteModels(db: Db): string[] {
  return db
    .select({ modelId: modelFavorites.modelId })
    .from(modelFavorites)
    .all()
    .map((row) => row.modelId);
}

export function addFavoriteModel(db: Db, modelId: string): string {
  const id = modelId.trim();
  if (!id) {
    return id;
  }
  db.insert(modelFavorites).values({ modelId: id }).onConflictDoNothing().run();
  return id;
}

export function removeFavoriteModel(db: Db, modelId: string): void {
  db.delete(modelFavorites).where(eq(modelFavorites.modelId, modelId.trim())).run();
}

export function isFavoriteModel(db: Db, modelId: string): boolean {
  return (
    db
      .select({ id: modelFavorites.modelId })
      .from(modelFavorites)
      .where(eq(modelFavorites.modelId, modelId.trim()))
      .get() !== undefined
  );
}
