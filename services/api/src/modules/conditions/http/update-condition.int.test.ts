import type { Condition } from "@kr/contracts";
import type { ConditionRow, JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

describe("updateCondition (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const fresh = async (): Promise<{ job: JobRow; condition: ConditionRow }> => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return { job, condition: await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" }) };
  };
  const patch = (
    who: SignedIn | undefined,
    job: Pick<JobRow, "id">,
    condition: Pick<ConditionRow, "id">,
    body: unknown,
    ifMatch: string | null = '"1"',
  ) =>
    apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}/conditions/${condition.id}`,
      ...(who ? { as: who } : {}),
      body,
      ...(ifMatch ? { headers: { "if-match": ifMatch } } : {}),
    });
  const row = (id: string) => t.db.selectFrom("conditions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const jobVersion = async (id: string) =>
    (await t.db.selectFrom("jobs").select("version").where("id", "=", id).executeTakeFirstOrThrow()).version;
  const audits = (jobId: string) =>
    t.db
      .selectFrom("audit_events")
      .selectAll()
      .where("job_id", "=", jobId)
      .where("action", "like", "condition.%")
      .execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("staff change the tick, responsibility, agency and KR comment; the condition version and ETag move, the job version does not", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const { job, condition } = await fresh();
      const res = await patch(who, job, condition, {
        isCleared: true,
        responsibility: "client",
        agency: "Water Corporation",
        krComment: "Booked for May",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).toBe('"2"');
      expect(res.json<Condition>()).toMatchObject({
        id: condition.id,
        number: 1,
        isCleared: true,
        responsibility: "client",
        agency: "Water Corporation",
        agencyGuessed: false,
        krComment: "Booked for May",
        version: 2,
        evidence: [],
      });
      expect(await row(condition.id)).toMatchObject({
        is_cleared: true,
        cleared_by: who.user.id,
        cleared_at: t.deps.clock.now(),
        agency_guessed: false,
        updated_by: who.user.id,
        version: 2,
      });
      expect(await jobVersion(job.id)).toBe(1);
    }
  });

  it("unticking clears who and when; 'Agency is correct' keeps the agency and clears the guess", async () => {
    const { job, condition } = await fresh();
    await t.db.updateTable("conditions").set({ agency_guessed: true }).where("id", "=", condition.id).execute();
    expect((await patch(staff, job, condition, { agencyConfirmed: true })).json<Condition>()).toMatchObject({
      agency: "Western Power",
      agencyGuessed: false,
      version: 2,
    });
    await patch(staff, job, condition, { isCleared: true }, '"2"');
    const res = await patch(staff, job, condition, { isCleared: false }, '"3"');
    expect(res.json<Condition>()).toMatchObject({ isCleared: false, version: 4 });
    expect(await row(condition.id)).toMatchObject({ is_cleared: false, cleared_at: null, cleared_by: null });
  });

  it("clients, architects and staff may write the client comment", async () => {
    const { job, condition } = await fresh();
    let version = 1;
    for (const [who, text] of [
      [client, "We will send the receipt"],
      [architect, "Plans updated"],
      [staff, "Thanks"],
    ] as const) {
      const res = await patch(who, job, condition, { clientComment: text }, `"${version}"`);
      expect(res.statusCode).toBe(200);
      expect(res.json<Condition>()).toMatchObject({ clientComment: text, krComment: "", isCleared: false });
      version += 1;
      expect(res.json<Condition>().version).toBe(version);
    }
  });

  it("answers 403 to a client or architect for any other field, alone or mixed with the client comment", async () => {
    const { job, condition } = await fresh();
    const bodies = [
      { isCleared: true },
      { responsibility: "kr" },
      { agency: "WAPC" },
      { agencyConfirmed: true },
      { krComment: "x" },
      { clientComment: "ok", isCleared: true },
    ];
    for (const who of [client, architect]) {
      for (const body of bodies) {
        const res = await patch(who, job, condition, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(403);
      }
    }
    expect(await row(condition.id)).toMatchObject({
      is_cleared: false,
      client_comment: "",
      kr_comment: "",
      version: 1,
    });
    expect(await audits(job.id)).toEqual([]);
  });

  it("writes one audit event with the diff, lengths for comments and never their text", async () => {
    const { job, condition } = await fresh();
    const res = await patch(staff, job, condition, {
      isCleared: true,
      krComment: "Bond of $5000 payable",
      clientComment: "Private client note",
    });
    const [event, ...rest] = await audits(job.id);
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      action: "condition.updated",
      actor_user_id: staff.user.id,
      entity_type: "condition",
      entity_id: condition.id,
      request_id: res.headers["x-request-id"],
      changes: {
        isCleared: { from: false, to: true },
        krCommentLength: { from: 0, to: 21 },
        clientCommentLength: { from: 0, to: 19 },
      },
    });
    expect(JSON.stringify(event?.changes)).not.toMatch(/Bond|Private/);
  });

  it("an edit that changes nothing keeps the version, the job version and the audit trail untouched", async () => {
    const { job, condition } = await fresh();
    const res = await patch(staff, job, condition, { isCleared: false, krComment: "" });
    expect(res.statusCode).toBe(200);
    expect(res.json<Condition>().version).toBe(1);
    expect(res.headers.etag).toBe('"1"');
    expect(await jobVersion(job.id)).toBe(1);
    expect(await audits(job.id)).toEqual([]);
  });

  it("needs If-Match: missing 428, malformed 400, stale 412 (the second editor reloads)", async () => {
    const { job, condition } = await fresh();
    expect((await patch(staff, job, condition, { krComment: "a" }, null)).statusCode).toBe(428);
    expect((await patch(staff, job, condition, { krComment: "a" }, "1")).statusCode).toBe(400);
    expect((await patch(staff, job, condition, { krComment: "a" })).statusCode).toBe(200);
    const stale = await patch(staff, job, condition, { krComment: "b" });
    expect(stale.statusCode).toBe(412);
    expect(await row(condition.id)).toMatchObject({ kr_comment: "a", version: 2 });
  });

  it("a superseded condition, another job's condition and an unknown id are 404", async () => {
    const { job, condition } = await fresh();
    const other = await fresh();
    await t.db
      .updateTable("conditions")
      .set({ superseded_at: t.deps.clock.now() })
      .where("id", "=", condition.id)
      .execute();
    expect((await patch(staff, job, condition, { krComment: "a" })).statusCode).toBe(404);
    expect((await patch(staff, job, other.condition, { krComment: "a" })).statusCode).toBe(404);
    expect(
      (await patch(staff, job, { id: "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11" }, { krComment: "a" })).statusCode,
    ).toBe(404);
  });

  it("is 404 for a caller without access or an archived job, 401 without a session, 400 for an empty or unknown field", async () => {
    const { job, condition } = await fresh();
    expect((await patch(outsider, job, condition, { clientComment: "hi" })).statusCode).toBe(404);
    expect((await patch(undefined, job, condition, { clientComment: "hi" })).statusCode).toBe(401);
    expect((await patch(staff, job, condition, {})).statusCode).toBe(400);
    expect((await patch(staff, job, condition, { text: "rewrite" })).statusCode).toBe(400);
    await t.db.updateTable("jobs").set({ deleted_at: t.deps.clock.now() }).where("id", "=", job.id).execute();
    expect((await patch(staff, job, condition, { krComment: "a" })).statusCode).toBe(404);
  });

  it("returns the condition's evidence with the viewer's delete right", async () => {
    const { job, condition } = await fresh();
    const mine = await f.makeFile({
      jobId: job.id,
      conditionId: condition.id,
      uploadedBy: client.user.id,
      name: "photo.pdf",
    });
    const theirs = await f.makeFile({
      jobId: job.id,
      conditionId: condition.id,
      uploadedBy: staff.user.id,
      name: "stat-dec.pdf",
    });
    const gone = await f.makeFile({ jobId: job.id, conditionId: condition.id, name: "removed.pdf" });
    await t.db.updateTable("files").set({ deleted_at: t.deps.clock.now() }).where("id", "=", gone.id).execute();
    const asClient = (await patch(client, job, condition, { clientComment: "see photo" })).json<Condition>();
    expect(asClient.evidence.map((e) => [e.id, e.canDelete, e.uploadedBy?.id])).toEqual([
      [mine.id, true, client.user.id],
      [theirs.id, false, staff.user.id],
    ]);
    const asStaff = (await patch(staff, job, condition, { krComment: "ok" }, '"2"')).json<Condition>();
    expect(asStaff.evidence.map((e) => e.canDelete)).toEqual([true, true]);
  });
});
