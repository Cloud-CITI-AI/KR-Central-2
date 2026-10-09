import { AccessGrant, AuditEvent, JobNote } from "@kr/contracts";
import { createDb, recordAudit, type Db } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createFactories, type Factories } from "../../../test/factories.js";
import { toAccessGrant, toAuditEvent, toJobNote } from "./read-models.js";

describe("note, grant and audit read models parse with the @kr/contracts schemas (real Postgres rows)", () => {
  let db: Db;
  let f: Factories;
  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
    f = createFactories(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it("maps notes (own and deletable), grants and audit events", async () => {
    const [author, other] = [await f.makeUser(), await f.makeUser()];
    const job = await f.makeJob();
    const noteRow = await f.makeNote({ jobId: job.id, authorId: author.id });
    const mine = JobNote.parse(toJobNote(noteRow, { author, viewerId: author.id, canDeleteAny: false }));
    expect([mine.isOwn, mine.canDelete]).toEqual([true, true]);
    const theirs = JobNote.parse(toJobNote(noteRow, { author, viewerId: other.id, canDeleteAny: false }));
    expect([theirs.isOwn, theirs.canDelete]).toEqual([false, false]);
    expect(toJobNote(noteRow, { author, viewerId: other.id, canDeleteAny: true }).canDelete).toBe(true);

    const grant = await f.makeGrant({ jobId: job.id, userId: other.id, role: "architect" });
    expect(AccessGrant.parse(toAccessGrant(grant, { jobNumber: job.job_number, invitedBy: author }))).toMatchObject({
      jobNumber: job.job_number,
      role: "architect",
      status: "active",
      invitedBy: { id: author.id },
    });

    await recordAudit(db, {
      actorUserId: author.id,
      action: "job.updated",
      entityType: "job",
      jobId: job.id,
      requestId: "req-1",
      changes: { address: { from: "a", to: "b" } },
    });
    const event = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("job_id", "=", job.id)
      .executeTakeFirstOrThrow();
    expect(AuditEvent.parse(toAuditEvent(event, author))).toMatchObject({
      id: event.id,
      actorType: "user",
      action: "job.updated",
      changes: { address: { from: "a", to: "b" } },
    });
  });
});
