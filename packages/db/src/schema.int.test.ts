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
    const r = await sql<{ d: string }>`SELECT DATE '2026-06-14' AS d`.execute(db);
    expect(r.rows[0]?.d).toBe("2026-06-14");
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

  it("rejects job numbers outside R15's character set", async () => {
    await expect(
      db.insertInto("jobs").values({ job_number: "S-0001<script>", address: "1 Test Rd" }).execute(),
    ).rejects.toThrow(/jobs_job_number_check/);
  });

  it("keeps evidence files and the conformed file on the same job (composite FKs)", async () => {
    const mkJob = async (n: string) =>
      db
        .insertInto("jobs")
        .values({ job_number: `${n}-${Date.now()}`, address: "1 Test Rd" })
        .returning("id")
        .executeTakeFirstOrThrow();
    const a = await mkJob("FKA");
    const b = await mkJob("FKB");
    const cond = await db
      .insertInto("conditions")
      .values({ job_id: a.id, condition_number: 1, text: "Synthetic condition", agency: "WAPC" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const fileRow = (jobId: string, key: string) => ({
      job_id: jobId,
      condition_id: cond.id,
      storage_key: key,
      original_name: "evidence.pdf",
      kind: "pdf" as const,
      content_type: "application/pdf",
      size_bytes: 1,
      sha256: Buffer.alloc(32),
    });
    await expect(
      db
        .insertInto("files")
        .values(fileRow(b.id, `jobs/${b.id}/x`))
        .execute(),
    ).rejects.toThrow(/files_condition_fk/);
    const ok = await db
      .insertInto("files")
      .values(fileRow(a.id, `jobs/${a.id}/y`))
      .returning("id")
      .executeTakeFirstOrThrow();
    await expect(
      db
        .updateTable("jobs")
        .set({ conformed_file_id: ok.id, conformed_date: "2026-01-02", conformed_method: "manual" })
        .where("id", "=", b.id)
        .execute(),
    ).rejects.toThrow(/jobs_conformed_file_fk/);
  });

  it("requires a browser-binding hash on every OIDC flow", async () => {
    await expect(
      sql`INSERT INTO auth_flows (state_hash, nonce, code_verifier, return_to, expires_at)
          VALUES (${Buffer.alloc(32)}, 'n', 'v', '/', now())`.execute(db),
    ).rejects.toThrow(/browser_binding_hash/);
  });
});
