import { CheckpointState, Condition, EmailMeta, FileMeta, UserRef } from "@kr/contracts";
import { createDb, type Db } from "@kr/db";
import { effectiveState } from "@kr/workflow";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createFactories, type Factories } from "../../../test/factories.js";
import { toCheckpointState, toCondition, toEmailMeta, toFileMeta, toUserRef } from "./read-models.js";

/** Real rows from Postgres 17 (bigint, timestamptz, jsonb as the driver returns them) through the mappers. */
describe("read models parse with the @kr/contracts schemas", () => {
  let db: Db;
  let f: Factories;
  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
    f = createFactories(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it("maps users, files (with email metadata and bigint sizes) and evidence", async () => {
    const user = await f.makeUser();
    const job = await f.makeJob({ createdBy: user.id });
    const file = await f.makeFile({ jobId: job.id, uploadedBy: user.id, sizeBytes: 3_000_000_000, kind: "email" });
    const email = await f.makeEmail(file.id);
    const row = await db.selectFrom("files").selectAll().where("id", "=", file.id).executeTakeFirstOrThrow();
    const meta = FileMeta.parse(toFileMeta(row, { uploader: user, canDelete: true, email }));
    expect(meta).toMatchObject({
      sizeBytes: 3_000_000_000,
      canDelete: true,
      uploadedBy: { id: user.id, displayName: user.display_name },
    });
    expect(EmailMeta.parse(toEmailMeta(email))).toMatchObject({ parseStatus: "parsed", isPasted: false });
    expect(toFileMeta(row, { uploader: null, canDelete: false, email: null })).toMatchObject({
      uploadedBy: null,
      email: null,
    });
    expect(UserRef.parse(toUserRef(user))).toEqual({ id: user.id, displayName: user.display_name });
    expect(toUserRef(null)).toBeNull();
    expect(JSON.stringify(toUserRef(user))).not.toContain("@");
  });

  it("maps conditions with their evidence", async () => {
    const job = await f.makeJob();
    const cond = await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    const evidence = await f.makeFile({ jobId: job.id, conditionId: cond.id });
    const evRow = await db.selectFrom("files").selectAll().where("id", "=", evidence.id).executeTakeFirstOrThrow();
    const row = await db.selectFrom("conditions").selectAll().where("id", "=", cond.id).executeTakeFirstOrThrow();
    const out = Condition.parse(
      toCondition(row, [toFileMeta(evRow, { uploader: null, canDelete: false, email: null })]),
    );
    expect(out).toMatchObject({ number: 1, agency: "Western Power", isCleared: false, version: 1 });
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0]?.conditionId).toBe(cond.id);
  });

  it("maps checkpoint states, including paid and decision, and hides restricted content", async () => {
    const user = await f.makeUser();
    const job = await f.makeJob();
    const at = new Date("2026-03-02T03:00:00Z");
    await db
      .updateTable("checkpoint_states")
      .set({
        kr_note: "Call the client",
        paid_at: at,
        paid_by: user.id,
        decision: "declined",
        decision_comment: "Too dear",
        decided_at: at,
        decided_by: user.id,
      })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i1_0p")
      .execute();
    const row = await db
      .selectFrom("checkpoint_states")
      .selectAll()
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i1_0p")
      .executeTakeFirstOrThrow();
    const file = await f.makeFile({ jobId: job.id, checkpointKey: "i1_0p", slot: "documents" });
    const fileRow = await db.selectFrom("files").selectAll().where("id", "=", file.id).executeTakeFirstOrThrow();
    const files = [toFileMeta(fileRow, { uploader: null, canDelete: false, email: null })];
    const effective = effectiveState("i1_0p", { states: {}, conditions: [] });
    const base = { effective, files, paidBy: user, decidedBy: user };

    const visible = CheckpointState.parse(toCheckpointState(row, { ...base, isRestricted: false }));
    expect(visible).toMatchObject({
      key: "i1_0p",
      krNote: "Call the client",
      paid: { at: at.toISOString(), by: { id: user.id } },
      decision: { value: "declined", comment: "Too dear", at: at.toISOString() },
      isRestricted: false,
      responsibility: "client",
    });
    expect(visible.files).toHaveLength(1);

    const hidden = CheckpointState.parse(toCheckpointState(row, { ...base, isRestricted: true }));
    expect(hidden).toMatchObject({
      key: "i1_0p",
      status: "not_completed",
      krNote: "",
      paid: null,
      decision: null,
      files: [],
      isRestricted: true,
    });
  });
});
