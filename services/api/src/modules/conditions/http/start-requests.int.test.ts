import type { Operation } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

describe("startConditionsExtraction and startConformanceReading (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let keyCounter = 0;
  const as = async (role: "admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const newKey = () => `test-key-${++keyCounter}-${"x".repeat(8)}`;
  const fresh = async (): Promise<JobRow> => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return job;
  };
  const letter = (
    job: Pick<JobRow, "id">,
    o: { name?: string; scanStatus?: "pending" | "clean" | "infected" | "error" } = {},
  ) =>
    f.makeFile({
      jobId: job.id,
      checkpointKey: "i5_0",
      slot: "decision",
      name: o.name ?? "WAPC Decision Letter.pdf",
      ...(o.scanStatus ? { scanStatus: o.scanStatus } : {}),
    });
  const notice = (job: Pick<JobRow, "id">, scanStatus: "pending" | "clean" = "clean") =>
    f.makeFile({ jobId: job.id, checkpointKey: "i4_2", slot: "conformance", name: "notice.pdf", scanStatus });
  const extract = (who: SignedIn | undefined, job: Pick<JobRow, "id">, body: unknown, key: string | null = newKey()) =>
    apiRequest(t, {
      method: "POST",
      url: `/v1/jobs/${job.id}/conditions/extractions`,
      ...(who ? { as: who } : {}),
      body,
      ...(key ? { headers: { "idempotency-key": key } } : {}),
    });
  const conform = (who: SignedIn | undefined, job: Pick<JobRow, "id">, body: unknown, key: string | null = newKey()) =>
    apiRequest(t, {
      method: "POST",
      url: `/v1/jobs/${job.id}/conformance-readings`,
      ...(who ? { as: who } : {}),
      body,
      ...(key ? { headers: { "idempotency-key": key } } : {}),
    });
  const operations = (jobId: string) => t.db.selectFrom("operations").selectAll().where("job_id", "=", jobId).execute();
  const audits = (jobId: string, like: string) =>
    t.db.selectFrom("audit_events").selectAll().where("job_id", "=", jobId).where("action", "like", like).execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff] = [await as("admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  describe("startConditionsExtraction", () => {
    it("queues one conditions.extract operation, answers 202 with Location and audits the request", async () => {
      for (const who of [staff, admin]) {
        const job = await fresh();
        const file = await letter(job);
        const res = await extract(who, job, { fileId: file.id });
        expect(res.statusCode).toBe(202);
        const op = res.json<Operation>();
        expect(op).toMatchObject({
          jobId: job.id,
          type: "conditions.extract",
          status: "queued",
          completedAt: null,
          result: null,
          error: null,
        });
        expect(res.headers.location).toBe(`/v1/operations/${op.id}`);
        const [row, ...rest] = await operations(job.id);
        expect(rest).toEqual([]);
        expect(row).toMatchObject({
          id: op.id,
          type: "conditions.extract",
          status: "queued",
          created_by: who.user.id,
          payload: { jobId: job.id, fileId: file.id, replaceExisting: false },
        });
        const [event, ...more] = await audits(job.id, "conditions.%");
        expect(more).toEqual([]);
        expect(event).toMatchObject({
          action: "conditions.extraction_requested",
          actor_user_id: who.user.id,
          entity_type: "operation",
          entity_id: op.id,
          request_id: res.headers["x-request-id"],
          changes: { fileId: { from: null, to: file.id }, replaceExisting: { from: null, to: false } },
        });
      }
    });

    it("the same Idempotency-Key returns the same operation id and queues nothing more", async () => {
      const job = await fresh();
      const file = await letter(job);
      const key = newKey();
      const first = await extract(staff, job, { fileId: file.id }, key);
      const again = await extract(staff, job, { fileId: file.id }, key);
      expect(again.statusCode).toBe(202);
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(again.headers.location).toBe(first.headers.location);
      expect(again.json<Operation>().id).toBe(first.json<Operation>().id);
      expect(await operations(job.id)).toHaveLength(1);
      expect(await audits(job.id, "conditions.%")).toHaveLength(1);
      const other = await extract(staff, job, { fileId: file.id });
      expect(other.json<Operation>().id).not.toBe(first.json<Operation>().id);
    });

    it("the same key with a different request is 409 and queues nothing", async () => {
      const job = await fresh();
      const [a, b] = [await letter(job), await letter(job, { name: "Decision 2.pdf" })];
      const key = newKey();
      expect((await extract(staff, job, { fileId: a.id }, key)).statusCode).toBe(202);
      const clash = await extract(staff, job, { fileId: b.id }, key);
      expect(clash.statusCode).toBe(409);
      expect(await operations(job.id)).toHaveLength(1);
    });

    it("requires an Idempotency-Key (400) and checks authorisation before it", async () => {
      const job = await fresh();
      const file = await letter(job);
      const res = await extract(staff, job, { fileId: file.id }, null);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errors: [{ path: "idempotency-key" }] });
      expect((await extract(client, job, { fileId: file.id }, null)).statusCode).toBe(403);
      expect(await operations(job.id)).toEqual([]);
    });

    it("rejects a file that is not a clean Decision Letter PDF in the 5.0 slot of this job (409)", async () => {
      const job = await fresh();
      const other = await fresh();
      const wrongName = await letter(job, { name: "approval.pdf" });
      const pending = await letter(job, { scanStatus: "pending" });
      const infected = await letter(job, { scanStatus: "infected" });
      const unscanned = await letter(job, { scanStatus: "error" });
      const deleted = await letter(job);
      await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", deleted.id).execute();
      const elsewhere = await letter(other);
      const wrongSlot = await f.makeFile({
        jobId: job.id,
        checkpointKey: "i4_2",
        slot: "conformance",
        name: "decision.pdf",
      });
      const image = await f.makeFile({
        jobId: job.id,
        checkpointKey: "i5_0",
        slot: "decision",
        name: "decision.png",
        kind: "image",
      });
      const cases: [string, { type: string; detail: string }][] = [
        [
          wrongName.id,
          {
            type: "urn:kr:problem:conflict",
            detail:
              'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.',
          },
        ],
        [
          pending.id,
          {
            type: "urn:kr:problem:file-not-ready",
            detail: "WAPC Decision Letter.pdf is still being checked for viruses. Try again in a moment.",
          },
        ],
        [
          unscanned.id,
          {
            type: "urn:kr:problem:file-not-ready",
            detail: "WAPC Decision Letter.pdf couldn't be checked for viruses – remove it and upload it again",
          },
        ],
        [
          infected.id,
          {
            type: "urn:kr:problem:file-rejected",
            detail: "WAPC Decision Letter.pdf was blocked because it failed the virus scan.",
          },
        ],
        ...[deleted.id, elsewhere.id, wrongSlot.id, image.id, "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11"].map(
          (id): [string, { type: string; detail: string }] => [
            id,
            {
              type: "urn:kr:problem:conflict",
              detail: "Conditions can only be read from a PDF in the WAPC conditional approval box (5.0).",
            },
          ],
        ),
      ];
      for (const [fileId, expected] of cases) {
        const res = await extract(staff, job, { fileId });
        expect(res.statusCode, fileId).toBe(409);
        expect(res.json(), fileId).toMatchObject(expected);
      }
      expect(await operations(job.id)).toEqual([]);
      expect(await audits(job.id, "conditions.%")).toEqual([]);
    });

    it("existing conditions need replaceExisting: 409 with the §5.5 count text, then 202 with the flag in the payload", async () => {
      const job = await fresh();
      const file = await letter(job);
      for (const number of [1, 2, 3]) await f.makeCondition({ jobId: job.id, number });
      await f.makeCondition({ jobId: job.id, number: 4 });
      await t.db
        .updateTable("conditions")
        .set({ superseded_at: new Date() })
        .where("job_id", "=", job.id)
        .where("condition_number", "=", 4)
        .execute();
      const refused = await extract(staff, job, { fileId: file.id });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        detail: "Replace the 3 existing conditions, including their ticks, comments and evidence?",
      });
      expect((await extract(staff, job, { fileId: file.id, replaceExisting: false })).statusCode).toBe(409);
      expect(await operations(job.id)).toEqual([]);
      const ok = await extract(staff, job, { fileId: file.id, replaceExisting: true });
      expect(ok.statusCode).toBe(202);
      expect((await operations(job.id))[0]?.payload).toEqual({ jobId: job.id, fileId: file.id, replaceExisting: true });
      expect((await audits(job.id, "conditions.%"))[0]?.changes).toMatchObject({ replaceExisting: { to: true } });
    });

    it("superseded conditions do not count: a job whose conditions were all replaced extracts without the flag", async () => {
      const job = await fresh();
      const file = await letter(job);
      await f.makeCondition({ jobId: job.id, number: 1 });
      await t.db.updateTable("conditions").set({ superseded_at: new Date() }).where("job_id", "=", job.id).execute();
      expect((await extract(staff, job, { fileId: file.id })).statusCode).toBe(202);
    });

    it("is staff only: a client or architect gets 403, anyone without access 404, no session 401", async () => {
      const job = await fresh();
      const file = await letter(job);
      for (const who of [client, architect])
        expect((await extract(who, job, { fileId: file.id })).statusCode).toBe(403);
      expect((await extract(outsider, job, { fileId: file.id })).statusCode).toBe(404);
      expect((await extract(undefined, job, { fileId: file.id })).statusCode).toBe(401);
      const archived = await f.makeJob({ deletedAt: new Date() });
      expect((await extract(staff, archived, { fileId: file.id })).statusCode).toBe(404);
      expect((await extract(staff, job, { fileId: "not-a-uuid" })).statusCode).toBe(400);
      expect(await operations(job.id)).toEqual([]);
    });
  });

  describe("startConformanceReading", () => {
    it("queues one conformance.read operation with allowAi from the ai-stamp-reading flag", async () => {
      const job = await fresh();
      const file = await notice(job);
      const res = await conform(staff, job, { fileId: file.id });
      expect(res.statusCode).toBe(202);
      const op = res.json<Operation>();
      expect(op).toMatchObject({ jobId: job.id, type: "conformance.read", status: "queued" });
      expect(res.headers.location).toBe(`/v1/operations/${op.id}`);
      expect((await operations(job.id))[0]).toMatchObject({
        type: "conformance.read",
        created_by: staff.user.id,
        payload: { jobId: job.id, fileId: file.id, allowAi: false },
      });
      expect((await audits(job.id, "conformance.%"))[0]).toMatchObject({
        action: "conformance.reading_requested",
        entity_id: op.id,
        changes: { fileId: { from: null, to: file.id } },
      });
    });

    it("sends allowAi true when the flag is on", async () => {
      const on = await createTestApp({ db: t.db, flags: { "ai-stamp-reading": true } });
      try {
        const job = await f.makeJob();
        const file = await notice(job);
        const res = await apiRequest(on, {
          method: "POST",
          url: `/v1/jobs/${job.id}/conformance-readings`,
          as: await signIn(on, await f.makeUser({ role: "staff" })),
          body: { fileId: file.id },
          headers: { "idempotency-key": newKey() },
        });
        expect(res.statusCode).toBe(202);
        expect((await operations(job.id))[0]?.payload).toMatchObject({ allowAi: true });
      } finally {
        await on.close();
      }
    });

    it("the same Idempotency-Key returns the same operation id; a missing key is 400", async () => {
      const job = await fresh();
      const file = await notice(job);
      const key = newKey();
      const first = await conform(staff, job, { fileId: file.id }, key);
      const again = await conform(staff, job, { fileId: file.id }, key);
      expect(again.json<Operation>().id).toBe(first.json<Operation>().id);
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(await operations(job.id)).toHaveLength(1);
      expect((await conform(staff, job, { fileId: file.id }, null)).statusCode).toBe(400);
    });

    it("rejects files outside the 4.2 slot, from other jobs and not yet scanned (409)", async () => {
      const job = await fresh();
      const decision = await letter(job);
      const elsewhere = await notice(await fresh());
      const pending = await notice(job, "pending");
      for (const id of [decision.id, elsewhere.id]) {
        const res = await conform(staff, job, { fileId: id });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({
          detail: "The conformed date can only be read from a PDF in the Conformance Notification box (4.2).",
        });
      }
      const res = await conform(staff, job, { fileId: pending.id });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:file-not-ready" });
      expect(await operations(job.id)).toEqual([]);
    });

    it("is staff only (403 for client and architect, 404 without access, 401 without a session)", async () => {
      const job = await fresh();
      const file = await notice(job);
      for (const who of [client, architect])
        expect((await conform(who, job, { fileId: file.id })).statusCode).toBe(403);
      expect((await conform(outsider, job, { fileId: file.id })).statusCode).toBe(404);
      expect((await conform(undefined, job, { fileId: file.id })).statusCode).toBe(401);
      expect(await operations(job.id)).toEqual([]);
    });
  });
});
