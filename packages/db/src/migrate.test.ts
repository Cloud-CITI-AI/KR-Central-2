import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrate.js";

describe("loadMigrations", () => {
  it("loads the shipped migrations in order with checksums", async () => {
    const files = await loadMigrations();
    expect(files[0]?.name).toBe("0001_initial_schema.sql");
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(files[0]?.transactional).toBe(true);
  });

  it("detects non-transactional files and rejects bad names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mig-"));
    await writeFile(
      join(dir, "0002_add_index.sql"),
      "-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY x ON y (z);\n",
    );
    expect((await loadMigrations(dir))[0]?.transactional).toBe(false);
    await writeFile(join(dir, "bad.sql"), "SELECT 1;");
    await expect(loadMigrations(dir)).rejects.toThrow(/Bad migration file name/);
  });
});
