import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { MIGRATIONS_DIR } from "./migrate.js";

/**
 * 0003 (FIX-R2-API): repairs rows that exist in a database migrated only to 0002, then enforces the new rules. The
 * test puts a transaction back into the 0002 state (drops what 0003 added, restores the old decline constraint), plants
 * bad rows, runs the real 0003 file, checks the outcome and rolls everything back.
 */
describe("migration 0003 on data that already violates the new rules", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({
      connectionString: inject("migratorDatabaseUrl"),
      options: "-c search_path=tracker,public",
    });
    await client.connect();
  });
  afterAll(async () => client.end());

  const job = async (n: string, cols: Record<string, string | null>) => {
    const keys = ["job_number", "address", ...Object.keys(cols)];
    const values = [`R2-${n}`, "1 Test Rd", ...Object.values(cols)];
    const r = await client.query<{ id: string }>(
      `INSERT INTO jobs (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      values,
    );
    return r.rows[0]!.id;
  };

  it("nulls out-of-range dates (a nulled conformed date takes its method and outcome date), fixes blank decline reasons, audits both, and then enforces the rules", async () => {
    const sql = await readFile(
      new URL("0003_dates_in_range_and_visible_decline_reason.sql", `file://${MIGRATIONS_DIR}`),
      "utf8",
    );
    await client.query("BEGIN");
    try {
      await client.query(`
        ALTER TABLE jobs DROP CONSTRAINT jobs_dates_in_range;
        ALTER TABLE checkpoint_states DROP CONSTRAINT checkpoint_states_decline_needs_comment;
        ALTER TABLE checkpoint_states ADD CONSTRAINT checkpoint_states_decline_needs_comment
          CHECK (decision IS DISTINCT FROM 'declined' OR length(btrim(decision_comment)) > 0);
        DROP FUNCTION is_blank_text(text);`);
      const expiry = await job("expiry", { approval_date: "2026-03-03", approval_expiry: "2999-03-03" });
      const old = await job("old", { approval_date: "1066-05-12" });
      const outcome = await job("outcome", {
        conformed_date: "2199-12-31",
        conformed_method: "manual",
        outcome_date: "2200-03-30",
      });
      const ancient = await job("ancient", {
        conformed_date: "1500-01-01",
        conformed_method: "text",
        conformed_stamp_text: "stamp",
        outcome_date: "2026-06-14",
      });
      const fine = await job("fine", {
        approval_date: "1900-01-01",
        approval_expiry: "2199-12-31",
        conformed_date: "2199-10-02",
        conformed_method: "manual",
        outcome_date: "2199-12-31",
      });
      const declined = await job("declined", {});
      for (const [key, comment] of [
        ["i6_1a", "​"],
        ["i6_2", "Too tight, please redo"],
      ] as const)
        await client.query(
          "INSERT INTO checkpoint_states (job_id, checkpoint_key, responsibility, decision, decision_comment, decided_at) VALUES ($1, $2, 'client', 'declined', $3, now())",
          [declined, key, comment],
        );

      await client.query(sql);

      const rows = (await client.query<{ id: string }>("SELECT * FROM jobs WHERE job_number LIKE 'R2-%'")).rows;
      const byId = (id: string) => rows.find((r) => r.id === id);
      expect(byId(expiry)).toMatchObject({
        approval_date: new Date("2026-03-03T00:00:00Z"),
        approval_expiry: null,
        version: 2,
      });
      expect(byId(old)).toMatchObject({ approval_date: null, version: 2 });
      expect(byId(outcome)).toMatchObject({
        conformed_date: new Date("2199-12-31T00:00:00Z"),
        outcome_date: null,
        version: 2,
      });
      expect(byId(ancient)).toMatchObject({
        conformed_date: null,
        conformed_method: null,
        conformed_file_id: null,
        conformed_stamp_text: null,
        outcome_date: null,
        version: 2,
      });
      expect(byId(fine)).toMatchObject({ version: 1, outcome_date: new Date("2199-12-31T00:00:00Z") });

      const audits = (
        await client.query("SELECT job_id, action, changes FROM audit_events WHERE action = 'job.dates_repaired'")
      ).rows;
      expect(audits.map((a: { job_id: string }) => a.job_id).sort()).toEqual([expiry, old, outcome, ancient].sort());
      expect(audits.find((a: { job_id: string }) => a.job_id === expiry)?.changes).toEqual({
        approvalExpiry: { from: "2999-03-03", to: null },
      });

      const states = (
        await client.query(
          "SELECT checkpoint_key, decision_comment, version FROM checkpoint_states WHERE job_id = $1 ORDER BY checkpoint_key",
          [declined],
        )
      ).rows;
      expect(states).toEqual([
        { checkpoint_key: "i6_1a", decision_comment: "(No reason was recorded)", version: 2 },
        { checkpoint_key: "i6_2", decision_comment: "Too tight, please redo", version: 1 },
      ]);
      expect(
        (
          await client.query(
            "SELECT 1 FROM audit_events WHERE action = 'checkpoint.decision_repaired' AND job_id = $1",
            [declined],
          )
        ).rowCount,
      ).toBe(1);

      await client.query("SAVEPOINT s");
      await expect(
        client.query("UPDATE jobs SET approval_expiry = '2999-03-03' WHERE id = $1", [fine]),
      ).rejects.toThrow(/jobs_dates_in_range/);
      await client.query("ROLLBACK TO SAVEPOINT s");
      await expect(
        client.query(
          "UPDATE checkpoint_states SET decision_comment = E'\\u200b\\u2060' WHERE job_id = $1 AND checkpoint_key = 'i6_2'",
          [declined],
        ),
      ).rejects.toThrow(/checkpoint_states_decline_needs_comment/);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
