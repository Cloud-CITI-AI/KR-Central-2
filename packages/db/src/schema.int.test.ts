import { CHECKPOINTS } from "@kr/workflow";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "./migrate.js";
import { createDb, type Db } from "./pool.js";

describe("schema (integration, real Postgres 17)", () => {
  let db: Db;

  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "db-int-test" });
  });
  afterAll(async () => db.destroy());

  it("seeds checkpoint_definitions exactly from the workflow package", async () => {
    const rows = await db.selectFrom("checkpoint_definitions").selectAll().orderBy("sort_order").execute();
    expect(
      rows.map((r) => [r.key, r.display_number, r.stage_key, r.title, r.default_responsibility, r.restricted]),
    ).toEqual(
      CHECKPOINTS.map((c) => [c.key, c.number, c.stage, c.title, c.defaultResponsibility, c.restricted ?? null]),
    );
  });

  it("is idempotent: re-running migrations applies nothing", async () => {
    expect(await migrate({ connectionString: inject("migratorDatabaseUrl") })).toEqual([]);
  });

  it("returns DATE columns as yyyy-mm-dd strings", async () => {
    const r = await sql<{ d: string }>`SELECT DATE '2025-10-26' AS d`.execute(db);
    expect(r.rows[0]?.d).toBe("2025-10-26");
  });

  it("keeps the audit log append-only for the app role", async () => {
    await db
      .insertInto("audit_events")
      .values({ actor_type: "system", action: "test.inserted", entity_type: "test" })
      .execute();
    await expect(sql`UPDATE audit_events SET action = 'test.changed'`.execute(db)).rejects.toThrow(/permission denied/);
    await expect(sql`DELETE FROM audit_events`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it("denies DDL to the app role (DB-6)", async () => {
    await expect(sql`CREATE TABLE not_allowed (x int)`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it("allows only one first-admin bootstrap row", async () => {
    const client = new pg.Client({ connectionString: inject("databaseUrl") });
    await client.connect();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const u = await client.query<{ id: string }>(
          "INSERT INTO users (entra_tenant_id, entra_object_id, display_name, is_guest) VALUES (gen_random_uuid(), gen_random_uuid(), 'Bootstrap test', false) RETURNING id",
        );
        ids.push(u.rows[0]!.id);
      }
      const results = await Promise.all(
        ids.map((id) =>
          client.query(
            "INSERT INTO system_bootstrap (first_admin_user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING first_admin_user_id",
            [id],
          ),
        ),
      );
      expect(results.reduce((n, r) => n + (r.rowCount ?? 0), 0)).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("rejects a declined decision without a comment", async () => {
    const job = await db
      .insertInto("jobs")
      .values({ job_number: `T-${Date.now()}`, address: "1 Test Rd" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("checkpoint_states")
      .values({ job_id: job.id, checkpoint_key: "i6_1a", responsibility: "client" })
      .execute();
    await expect(
      db
        .updateTable("checkpoint_states")
        .set({ decision: "declined", decision_comment: " ", decided_at: new Date() })
        .where("job_id", "=", job.id)
        .execute(),
    ).rejects.toThrow(/checkpoint_states_decline_needs_comment/);
  });
});
