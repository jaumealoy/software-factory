import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, factoryMeta, runMigrations } from "../src/db/index.js";
import { migrationsDir } from "../src/paths.js";

describe("database", () => {
  it("applies migrations and supports a read/write roundtrip", async () => {
    const handle = createDb(":memory:");
    runMigrations(handle.db, migrationsDir);

    await handle.db.insert(factoryMeta).values({
      key: "schema_version",
      value: "1",
      updatedAt: new Date(),
    });

    const rows = await handle.db
      .select()
      .from(factoryMeta)
      .where(eq(factoryMeta.key, "schema_version"));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("1");

    handle.client.close();
  });
});
