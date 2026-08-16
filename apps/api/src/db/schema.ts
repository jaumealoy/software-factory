import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const factoryMeta = sqliteTable("factory_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type FactoryMeta = typeof factoryMeta.$inferSelect;
export type NewFactoryMeta = typeof factoryMeta.$inferInsert;
