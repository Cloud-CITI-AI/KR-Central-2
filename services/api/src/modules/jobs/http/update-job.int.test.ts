import type { JobDetail } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";

type Detail = z.output<typeof JobDetail>;

describe("updateJob (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const fresh = async () => {
    const job = await f.makeJob();
    await f.makeGrant({ jobId: job.id, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId: job.id, userId: architect.user.id, role: "architect" });
    return job;
  };
  const patch = (
    who: SignedIn | undefined,
    job: Pick<JobRow, "id">,
    body: unknown,
    version: number | string | null = 1,
  ) =>
    apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}`,
      ...(who ? { as: who } : {}),
      body,
      headers: version === null ? {} : { "if-match": typeof version === "number" ? `"${version}"` : version },
    });
  const row = (id: string) => t.db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const audits = (id: string) =>
    t.db.selectFrom("audit_events").selectAll().where("job_id", "=", id).where("action", "=", "job.updated").execute();

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
    [client, architect, outsider] = [await as("external"), await as("external"), await as("external")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("updates details and WAPC dates for staff, kr_admin and admin, bumping the version and auditing the diff", async () => {
    for (const who of [staff, krAdmin, admin]) {
      const job = await fresh();
      const res = await patch(who, job, {
        address: "9 Changed Road, Testville",
        clientName: null,
        subdivisionType: "Built Strata",
        approvalDate: "2026-03-02",
        approvalExpiry: "2029-03-02",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers.etag).toBe('"2"');
      const detail = res.json<Detail>();
      expect(detail).toMatchObject({
        address: "9 Changed Road, Testville",
        clientName: null,
        subdivisionType: "Built Strata",
        approvalDate: "2026-03-02",
        approvalExpiry: "2029-03-02",
        version: 2,
      });
      expect(detail.checkpoints).toHaveLength(46);
      const [event, ...rest] = await audits(job.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        actor_user_id: who.user.id,
        entity_id: job.id,
        request_id: res.headers["x-request-id"],
        changes: {
          address: { from: job.address, to: "9 Changed Road, Testville" },
          clientName: { from: job.client_name, to: null },
          approvalExpiry: { from: null, to: "2029-03-02" },
        },
      });
    }
  });

  it("raises the expiry alert from the new dates, using the injected clock", async () => {
    const job = await fresh();
    const res = await patch(staff, job, { approvalExpiry: "2026-03-01" });
    expect(res.json<Detail>().summary.alerts.map((a) => a.text)).toEqual(["WAPC approval expired Sun, 1 Mar 2026"]);
  });

  it("refuses a client, an architect and callers who cannot see the job, and changes nothing", async () => {
    const job = await fresh();
    expect((await patch(client, job, { address: "x" })).statusCode).toBe(403);
    expect((await patch(architect, job, { address: "x" })).statusCode).toBe(403);
    expect((await patch(outsider, job, { address: "x" })).statusCode).toBe(404);
    expect((await patch(undefined, job, { address: "x" })).statusCode).toBe(401);
    const noCsrf = await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${job.id}`,
      as: staff,
      csrf: null,
      body: { address: "x" },
      headers: { "if-match": '"1"' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await row(job.id)).toMatchObject({ address: job.address, version: 1 });
    expect(await audits(job.id)).toEqual([]);
  });

  it("is 404 for an archived job", async () => {
    const job = await fresh();
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", job.id).execute();
    expect((await patch(staff, job, { address: "x" })).statusCode).toBe(404);
  });

  it("requires If-Match: missing 428, malformed 400, stale 412 with nothing written", async () => {
    const job = await fresh();
    expect((await patch(staff, job, { address: "a" }, null)).statusCode).toBe(428);
    expect((await patch(staff, job, { address: "a" }, "abc")).statusCode).toBe(400);
    const stale = await patch(staff, job, { address: "a" }, 5);
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ type: "urn:kr:problem:precondition-failed" });
    expect(await row(job.id)).toMatchObject({ address: job.address, version: 1 });
    expect(await audits(job.id)).toEqual([]);
    expect((await patch(staff, job, { address: "b" }, 1)).statusCode).toBe(200);
    expect((await patch(staff, job, { address: "c" }, 1)).statusCode).toBe(412);
  });

  it("keeps the job's own version out of checkpoint and condition writes: a date edit made from an older read still saves", async () => {
    const job = await fresh();
    const condition = await f.makeCondition({ jobId: job.id, number: 1, agency: "Western Power" });
    const read = await apiRequest(t, { url: `/v1/jobs/${job.id}`, as: staff });
    const version = read.json<Detail>().version;
    const write = (url: string, method: "PUT" | "PATCH", as: SignedIn, body?: unknown) =>
      apiRequest(t, { method, url, as, ...(body === undefined ? {} : { body }), headers: { "if-match": '"1"' } });
    const base = `/v1/jobs/${job.id}`;
    expect((await write(`${base}/checkpoints/i6_2/paid`, "PUT", client)).statusCode).toBe(200);
    expect((await write(`${base}/checkpoints/i4_1`, "PATCH", staff, { status: "not_required" })).statusCode).toBe(200);
    expect((await write(`${base}/checkpoints/i3_0p/decision`, "PUT", client, { value: "accepted" })).statusCode).toBe(
      200,
    );
    expect(
      (await write(`${base}/conditions/${condition.id}`, "PATCH", staff, { krComment: "Booked" })).statusCode,
    ).toBe(200);
    expect((await row(job.id)).version).toBe(version);
    const edit = await patch(admin, job, { approvalExpiry: "2028-01-01" }, version);
    expect(edit.statusCode).toBe(200);
    expect(edit.json<Detail>()).toMatchObject({ approvalExpiry: "2028-01-01", version: version + 1 });
  });

  it("lets exactly one of two concurrent edits with the same version win", async () => {
    const job = await fresh();
    const results = await Promise.all([patch(staff, job, { address: "one" }), patch(admin, job, { address: "two" })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 412]);
    expect((await row(job.id)).version).toBe(2);
    expect(await audits(job.id)).toHaveLength(1);
  });

  it("changes nothing for a request that matches the stored values, but still checks the version", async () => {
    const job = await fresh();
    const same = await patch(staff, job, { address: job.address, approvalDate: null });
    expect(same.statusCode).toBe(200);
    expect(same.headers.etag).toBe('"1"');
    expect(await audits(job.id)).toEqual([]);
    expect((await patch(staff, job, { address: job.address }, 9)).statusCode).toBe(412);
  });

  it("answers 409 for a number already in use (any case) and allows re-casing its own number", async () => {
    const [a, b] = [await fresh(), await fresh()];
    const dup = await patch(staff, b, { jobNumber: a.job_number.toLowerCase() });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ detail: `${a.job_number.toLowerCase()} is already in use.` });
    expect(await row(b.id)).toMatchObject({ job_number: b.job_number, version: 1 });
    const recase = await patch(staff, a, { jobNumber: a.job_number.toLowerCase() });
    expect(recase.statusCode).toBe(200);
    expect(recase.json<Detail>().jobNumber).toBe(a.job_number.toLowerCase());
  });

  it("can take the number of an archived job", async () => {
    const [a, b] = [await fresh(), await fresh()];
    await t.db.updateTable("jobs").set({ deleted_at: new Date() }).where("id", "=", a.id).execute();
    expect((await patch(staff, b, { jobNumber: a.job_number })).statusCode).toBe(200);
  });

  it("sets a manual conformed date: method manual, outcome +90 days, reading provenance cleared", async () => {
    const job = await fresh();
    const stamp = await f.makeFile({
      jobId: job.id,
      checkpointKey: "i4_2",
      slot: "conformance",
      name: "Conformed.pdf",
    });
    await t.db
      .updateTable("jobs")
      .set({
        conformed_date: "2026-02-10",
        conformed_method: "stamp_annotation",
        conformed_file_id: stamp.id,
        conformed_stamp_text: "Conformed 10 Feb 2026",
        outcome_date: "2026-05-11",
      })
      .where("id", "=", job.id)
      .execute();
    const res = await patch(staff, job, { conformedDate: "2026-03-01" });
    expect(res.statusCode).toBe(200);
    expect(res.json<Detail>()).toMatchObject({
      conformedDate: "2026-03-01",
      conformedSource: { method: "manual", fileName: null, stampText: null },
      outcomeDate: "2026-05-30",
    });
    expect(await row(job.id)).toMatchObject({ conformed_file_id: null, conformed_stamp_text: null });
    const [event] = await audits(job.id);
    expect(event?.changes).toMatchObject({
      conformedDate: { from: "2026-02-10", to: "2026-03-01" },
      conformedMethod: { from: "stamp_annotation", to: "manual" },
      outcomeDate: { from: "2026-05-11", to: "2026-05-30" },
    });
  });

  it("keeps an outcome date sent with the conformed date, edits it alone, and clears the conformed date", async () => {
    const job = await fresh();
    const both = await patch(staff, job, { conformedDate: "2026-02-10", outcomeDate: "2026-06-01" });
    expect(both.json<Detail>()).toMatchObject({ conformedDate: "2026-02-10", outcomeDate: "2026-06-01", version: 2 });
    const deferral = await patch(staff, job, { outcomeDate: "2026-07-01" }, 2);
    expect(deferral.json<Detail>()).toMatchObject({ conformedDate: "2026-02-10", outcomeDate: "2026-07-01" });
    const cleared = await patch(staff, job, { conformedDate: null }, 3);
    expect(cleared.json<Detail>()).toMatchObject({
      conformedDate: null,
      conformedSource: null,
      outcomeDate: "2026-07-01",
    });
  });

  it("rejects an empty body, unknown fields, bad dates and bad numbers with 400", async () => {
    const job = await fresh();
    for (const body of [
      {},
      { version: 3 },
      { approvalDate: "2026-02-30" },
      { outcomeDate: "tomorrow" },
      { jobNumber: "S_1" },
      { address: "" },
      { subdivisionType: "Bogus" },
    ]) {
      const res = await patch(staff, job, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await patch(staff, { id: "nope" }, { address: "x" })).statusCode).toBe(400);
    expect((await row(job.id)).version).toBe(1);
  });

  it("returns the viewer's restricted view of the fee proposal in the response", async () => {
    const job = await fresh();
    await t.db
      .updateTable("checkpoint_states")
      .set({ kr_note: "fee note" })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i1_0p")
      .execute();
    const res = await patch(staff, job, { address: "new address" });
    expect(res.json<Detail>().checkpoints.find((c) => c.key === "i1_0p")).toMatchObject({
      isRestricted: true,
      krNote: "",
    });
    expect(res.body).not.toContain("fee note");
  });
});
