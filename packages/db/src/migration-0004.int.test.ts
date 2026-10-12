import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { MIGRATIONS_DIR } from "./migrate.js";

/**
 * 0004 (FIX-R2-API): files.scan_retries_exhausted. The test puts a transaction back into the 0003 state (column dropped),
 * plants files in every scan state, runs the real 0004 file and checks the backfill, then rolls everything back.
 */
describe("migration 0004 on files that already hold failed scans", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({
      connectionString: inject("migratorDatabaseUrl"),
      options: "-c search_path=tracker,public",
    });
    await client.connect();
  });
  afterAll(async () => client.end());

  it("flags only files left in error after the fourth failed scan, and defaults new files to false", async () => {
    const sql = await readFile(new URL("0004_files_scan_retries_exhausted.sql", `file://${MIGRATIONS_DIR}`), "utf8");
    await client.query("BEGIN");
    try {
      await client.query("ALTER TABLE files DROP COLUMN scan_retries_exhausted");
      const job = (
        await client.query<{ id: string }>(
          "INSERT INTO jobs (job_number, address) VALUES ('R2-0004', '1 Test Rd') RETURNING id",
        )
      ).rows[0]!.id;
      await client.query("INSERT INTO checkpoint_states (job_id, checkpoint_key) VALUES ($1, 'i2_0')", [job]);
      const file = async (n: number, status: string, attempts: number) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO files (job_id, checkpoint_key, slot, storage_key, original_name, kind, content_type, size_bytes, sha256,
                                scan_status, scan_attempts)
             VALUES ($1, 'i2_0', 'survey', $2, 'f.pdf', 'pdf', 'application/pdf', 10, decode(repeat('ab', 32), 'hex'), $3, $4)
             RETURNING id`,
            [job, `jobs/r2-0004/${n}`, status, attempts],
          )
        ).rows[0]!.id;
      const first = await file(1, "error", 1);
      const third = await file(2, "error", 3);
      const fourth = await file(3, "error", 4);
      const cleanAfterRetries = await file(4, "clean", 4);

      await client.query(sql);

      const flag = async (id: string) =>
        (await client.query<{ f: boolean }>("SELECT scan_retries_exhausted AS f FROM files WHERE id = $1", [id]))
          .rows[0]!.f;
      expect(await flag(first)).toBe(false);
      expect(await flag(third)).toBe(false);
      expect(await flag(fourth)).toBe(true);
      expect(await flag(cleanAfterRetries)).toBe(false);
      expect(await file(5, "pending", 0).then(flag)).toBe(false);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
