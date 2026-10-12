import type { JobDetail } from "@kr/contracts";
import { CHECKPOINTS } from "@kr/workflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Detail = z.output<typeof JobDetail>;

describe("getJob (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  let feeFileId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const get = (who: SignedIn | undefined, id = jobId) =>
    apiRequest(t, { url: `/v1/jobs/${id}`, ...(who ? { as: who } : {}) });
  const cp = (d: Detail, key: string) => d.checkpoints.find((c) => c.key === key)!;

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
    const job = await f.makeJob({ createdBy: staff.user.id });
    jobId = job.id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
    await f.makeGrant({ jobId, userId: outsider.user.id, role: "client", status: "revoked" });
    const feeNote = { kr_note: "Fee note for the client only", status: "completed" as const };
    await t.db
      .updateTable("checkpoint_states")
      .set({
        ...feeNote,
        decision: "accepted",
        decided_at: new Date("2026-02-01T00:00:00Z"),
        decided_by: client.user.id,
      })
      .where("job_id", "=", jobId)
      .where("checkpoint_key", "=", "i1_0p")
      .execute();
    feeFileId = (await f.makeFile({ jobId, checkpointKey: "i1_0p", slot: "documents", name: "fee-proposal.pdf" })).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("returns the full tracker view with the version as ETag to staff, kr_admin and admin", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const res = await get(who);
      expect(res.statusCode).toBe(200);
      const job = res.json<Detail>();
      expect(res.headers.etag).toBe(`"${job.version}"`);
      expect(job.id).toBe(jobId);
      expect(job.checkpoints).toHaveLength(46);
      expect(job.checkpoints.map((c) => c.key)).toEqual(CHECKPOINTS.map((c) => c.key));
      expect(job.capabilities).toContain("job.edit");
      expect(job.viewerGrantRole).toBeNull();
    }
    expect((await get(admin)).json<Detail>().capabilities).toContain("job.delete");
    expect((await get(staff)).json<Detail>().capabilities).not.toContain("job.delete");
  });

  it("returns the job to a client and an architect grant with their own capabilities", async () => {
    const c = (await get(client)).json<Detail>();
    expect(c.viewerGrantRole).toBe("client");
    expect(c.capabilities).toContain("fee_proposal.view");
    expect(c.capabilities).not.toContain("job.edit");
    const a = (await get(architect)).json<Detail>();
    expect(a.viewerGrantRole).toBe("architect");
    expect(a.capabilities).not.toContain("checkpoint.decision.record");
  });

  it("answers 404 for callers who cannot see the job and for jobs that do not exist", async () => {
    const pending = await as("external");
    await f.makeGrant({ jobId, userId: pending.user.id, role: "client", status: "pending" });
    for (const who of [outsider, pending, await as("external")]) {
      const res = await get(who);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:not-found" });
    }
    expect((await get(staff, "0f8fad5b-d9cb-469f-a165-70867728950e")).statusCode).toBe(404);
  });

  it("is 404 for everyone once the job is archived, grants included", async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    expect((await get(client, job.id)).statusCode).toBe(200);
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    for (const who of [client, staff, krAdmin, admin]) expect((await get(who, job.id)).statusCode).toBe(404);
  });

  it("rejects a malformed id (400), anonymous callers (401) and a disabled user (401)", async () => {
    expect((await get(staff, "not-a-uuid")).statusCode).toBe(400);
    expect((await get(undefined)).statusCode).toBe(401);
    const gone = await as("staff");
    await t.db.updateTable("users").set({ status: "disabled" }).where("id", "=", gone.user.id).execute();
    expect((await get(gone)).statusCode).toBe(401);
  });

  it("shows the fee proposal note, decision and files to kr_admin, admin and the client", async () => {
    for (const who of [krAdmin, admin, client]) {
      const fee = cp((await get(who)).json<Detail>(), "i1_0p");
      expect(fee).toMatchObject({
        isRestricted: false,
        krNote: "Fee note for the client only",
        decision: { value: "accepted" },
      });
      expect(fee.files.map((x) => x.id)).toEqual([feeFileId]);
    }
  });

  it("hides the fee proposal note, decision, files and file count from staff and architects", async () => {
    const kept = (await get(krAdmin)).json<Detail>();
    for (const who of [staff, architect]) {
      const res = await get(who);
      const job = res.json<Detail>();
      expect(cp(job, "i1_0p")).toMatchObject({
        isRestricted: true,
        status: "completed",
        responsibility: "client",
        krNote: "",
        decision: null,
        paid: null,
        files: [],
      });
      for (const secret of ["Fee note for the client only", "fee-proposal.pdf", feeFileId, client.user.display_name]) {
        expect(res.body).not.toContain(secret);
      }
      expect(job.summary.fileCount).toBe(kept.summary.fileCount - 1);
    }
  });

  it("tells a failed scan the worker will still retry from one that is final (scanRetriesExhausted)", async () => {
    const job = await f.makeJob();
    const retrying = await f.makeFile({ jobId: job.id, checkpointKey: "i2_0", slot: "survey", scanStatus: "error" });
    const final = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i2_0",
      slot: "survey",
      scanStatus: "error",
      scanRetriesExhausted: true,
    });
    const files = cp((await get(staff, job.id)).json<Detail>(), "i2_0").files;
    expect(files.map((x) => [x.id, x.scanStatus, x.scanRetriesExhausted])).toEqual([
      [retrying.id, "error", false],
      [final.id, "error", true],
    ]);
  });

  it("lists the files that are not deleted, with scan state, uploader and canDelete", async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    const own = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i3_0p",
      slot: "consent",
      uploadedBy: client.user.id,
    });
    const staffs = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i3_0p",
      slot: "consent",
      uploadedBy: staff.user.id,
    });
    const scanning = await f.makeFile({ jobId: job.id, checkpointKey: "i2_0", slot: "survey", scanStatus: "pending" });
    const removed = await f.makeFile({ jobId: job.id, checkpointKey: "i2_0", slot: "survey" });
    await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", removed.id).execute();
    const mail = await f.makeFile({ jobId: job.id, checkpointKey: "i4_3", slot: "emails", kind: "email" });
    await f.makeEmail(mail.id);

    const asClient = (await get(client, job.id)).json<Detail>();
    const consent = cp(asClient, "i3_0p").files;
    expect(consent.map((x) => [x.id, x.canDelete])).toEqual([
      [own.id, true],
      [staffs.id, false],
    ]);
    expect(consent[0]?.uploadedBy).toEqual({ id: client.user.id, displayName: client.user.display_name });
    expect(cp(asClient, "i2_0").files.map((x) => [x.id, x.scanStatus])).toEqual([[scanning.id, "pending"]]);
    expect(cp(asClient, "i4_3").files[0]?.email).toMatchObject({
      parseStatus: "parsed",
      from: "assessor@example.test",
    });
    expect(asClient.summary.fileCount).toBe(3);
    expect(JSON.stringify(asClient)).not.toContain(removed.id);
    expect(cp((await get(staff, job.id)).json<Detail>(), "i3_0p").files.every((x) => x.canDelete)).toBe(true);
    expect(cp((await get(architect, job.id)).json<Detail>(), "i3_0p").files.some((x) => x.canDelete)).toBe(false);
  });

  it("includes current conditions with evidence, applies agency exclusion and names the source files", async () => {
    const job = await f.makeJob();
    const letter = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i5_0",
      slot: "decision",
      name: "Decision Letter.pdf",
    });
    const stamp = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i4_2",
      slot: "conformance",
      name: "Conformed.pdf",
    });
    const current = await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    const old = await f.makeCondition({ jobId: job.id, number: 2, agency: "Water Corporation" });
    await t.db.updateTable("conditions").set({ superseded_at: new Date() }).where("id", "=", old.id).execute();
    const evidence = await f.makeFile({ jobId: job.id, conditionId: current.id });
    await t.db
      .updateTable("jobs")
      .set({
        conditions_source_file_id: letter.id,
        conditions_extracted_at: new Date("2026-02-02T00:00:00Z"),
        conformed_date: "2026-02-10",
        conformed_method: "stamp_annotation",
        conformed_file_id: stamp.id,
        conformed_stamp_text: "Conformed 10 Feb 2026",
        outcome_date: "2026-05-11",
        approval_expiry: "2026-03-20",
      })
      .where("id", "=", job.id)
      .execute();
    await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", letter.id).execute();

    const d = (await get(staff, job.id)).json<Detail>();
    expect(d.conditions.map((c) => [c.number, c.evidence.map((e) => e.id)])).toEqual([[1, [evidence.id]]]);
    expect(cp(d, "i7_0")).toMatchObject({
      status: "not_required",
      storedStatus: "not_completed",
      excludedByConditions: true,
    });
    expect(cp(d, "i6_0")).toMatchObject({ status: "not_completed", excludedByConditions: false });
    expect(d.conditionsSource).toEqual({
      fileId: letter.id,
      fileName: "Decision Letter.pdf",
      extractedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(d.conformedSource).toEqual({
      method: "stamp_annotation",
      fileName: "Conformed.pdf",
      stampText: "Conformed 10 Feb 2026",
    });
    expect(d).toMatchObject({ conformedDate: "2026-02-10", outcomeDate: "2026-05-11" });
    expect(d.summary.alerts.map((a) => a.code)).toEqual(["approval_expiring"]);
    expect(d.summary.stages.find((s) => s.stage === "water-corporation")?.excluded).toBe(true);
  });
});
