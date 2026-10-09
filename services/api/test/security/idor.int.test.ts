/**
 * Object-level authorisation (OWASP API1): an id that belongs to another job, an unknown id and an archived job must be
 * indistinguishable, a grant is checked on every request, and a body cannot smuggle in fields the contract does not name.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfBytes, pngBytes, seedFile, uploadFile } from "../../src/modules/files/testing.js";
import { apiRequest, signIn, type SignedIn } from "../helpers/index.js";
import { createWorld, type World } from "./support.js";

const UNKNOWN = "2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77";
const V1 = { "if-match": '"1"' };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let w: World;
/** Job A (client and architect hold grants) and job B (only clientOfB does), each with a condition, a note, a file and an operation. */
let a: Awaited<ReturnType<typeof scene>>;
let b: Awaited<ReturnType<typeof scene>>;
let clientOfB: SignedIn;

async function scene(job: { id: string }) {
  const { f, t } = w;
  const [condition, note] = [
    await f.makeCondition({ jobId: job.id, number: 1 }),
    await f.makeNote({ jobId: job.id, authorId: w.actors.staff.user.id }),
  ];
  const file = await seedFile(t, f, { jobId: job.id, data: pdfBytes(), uploadedBy: w.actors.client.user.id });
  const decision = await seedFile(t, f, {
    jobId: job.id,
    data: pdfBytes(),
    checkpointKey: "i5_0",
    slot: "decision",
    name: "Decision Letter.pdf",
  });
  const { enqueueOperation } = await import("@kr/db");
  const op = await enqueueOperation(t.db, { jobId: job.id, type: "conditions.extract", payload: {}, createdBy: null });
  return { job, condition, note, file, decision, op };
}

beforeAll(async () => {
  w = await createWorld();
  [a, b] = [await scene(await w.freshJob()), await scene(await w.f.makeJob())];
  clientOfB = await signIn(w.t, await w.f.makeUser({ role: "external" }));
  await w.f.makeGrant({ jobId: b.job.id, userId: clientOfB.user.id, role: "client" });
});
afterAll(async () => {
  await w.t.close();
});

const call = (who: SignedIn, method: Method, url: string, body?: unknown, headers?: Record<string, string>) =>
  apiRequest(w.t, { method, url, as: who, ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) });
/** The answer minus what is per request (ids, instance), to compare two refusals. */
const shape = (res: { statusCode: number; json: () => unknown }) => {
  const { requestId: _r, instance: _i, ...rest } = res.json() as Record<string, unknown>;
  return { status: res.statusCode, ...rest };
};

describe("ids that belong to another job", () => {
  it("a client of job A gets 404 for every read and write on job B, whatever the id", async () => {
    const client = w.actors.client;
    const attempts: [Method, string, unknown?, Record<string, string>?][] = [
      ["GET", `/v1/jobs/${b.job.id}`],
      ["GET", `/v1/jobs/${b.job.id}/notes`],
      ["GET", `/v1/jobs/${b.job.id}/package`],
      ["GET", `/v1/files/${b.file.id}`],
      ["GET", `/v1/files/${b.file.id}/content`],
      ["DELETE", `/v1/files/${b.file.id}`],
      ["GET", `/v1/operations/${b.op.id}`],
      ["PATCH", `/v1/jobs/${b.job.id}/conditions/${b.condition.id}`, { clientComment: "x" }, V1],
      ["POST", `/v1/jobs/${b.job.id}/notes`, { body: "x" }],
      ["PUT", `/v1/jobs/${b.job.id}/checkpoints/i3_0p/decision`, { value: "accepted" }],
      ["PUT", `/v1/jobs/${b.job.id}/checkpoints/i6_2/paid`],
    ];
    for (const [method, url, body, headers] of attempts) {
      const res = await call(client, method, url, body, headers);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("answers the same 404 for another job's id as for an id that exists nowhere (no oracle)", async () => {
    for (const [other, nowhere] of [
      [`/v1/jobs/${b.job.id}`, `/v1/jobs/${UNKNOWN}`],
      [`/v1/files/${b.file.id}`, `/v1/files/${UNKNOWN}`],
      [`/v1/files/${b.file.id}/content`, `/v1/files/${UNKNOWN}/content`],
      [`/v1/operations/${b.op.id}`, `/v1/operations/${UNKNOWN}`],
    ]) {
      const [x, y] = [
        await call(w.actors.client, "GET", other ?? ""),
        await call(w.actors.client, "GET", nowhere ?? ""),
      ];
      expect(shape(x)).toEqual(shape(y));
    }
  });

  it("a staff member working in job A cannot reach job B's condition, note or evidence through A's path", async () => {
    const staff = w.actors.staff;
    const cases: [Method, string, unknown?, Record<string, string>?][] = [
      ["PATCH", `/v1/jobs/${a.job.id}/conditions/${b.condition.id}`, { isCleared: true }, V1],
      ["DELETE", `/v1/jobs/${a.job.id}/notes/${b.note.id}`],
    ];
    for (const [method, url, body, headers] of cases)
      expect((await call(staff, method, url, body, headers)).statusCode, url).toBe(404);
    const notesBefore = await w.t.db.selectFrom("job_notes").select("id").where("id", "=", b.note.id).execute();
    expect(notesBefore).toHaveLength(1);
    expect(
      (await w.t.db.selectFrom("conditions").selectAll().where("id", "=", b.condition.id).executeTakeFirstOrThrow())
        .is_cleared,
    ).toBe(false);
  });

  it("evidence cannot be attached to another job's condition, nor can a file of job B start work on job A", async () => {
    const staff = w.actors.staff;
    const res = await uploadFile(w.t, {
      jobId: a.job.id,
      as: staff,
      fields: { conditionId: b.condition.id },
      file: { name: "e.png", data: pngBytes() },
    });
    expect(res.statusCode).toBe(404);
    expect(await w.t.db.selectFrom("files").select("id").where("condition_id", "=", b.condition.id).execute()).toEqual(
      [],
    );
    const key = { "idempotency-key": randomUUID() };
    const foreign = await call(
      staff,
      "POST",
      `/v1/jobs/${a.job.id}/conditions/extractions`,
      { fileId: b.decision.id },
      key,
    );
    const nowhere = await call(
      staff,
      "POST",
      `/v1/jobs/${a.job.id}/conditions/extractions`,
      { fileId: UNKNOWN },
      { "idempotency-key": randomUUID() },
    );
    expect(foreign.statusCode).toBe(409);
    expect(shape(foreign)).toEqual(shape(nowhere));
    const conformance = await call(
      staff,
      "POST",
      `/v1/jobs/${a.job.id}/conformance-readings`,
      { fileId: b.file.id },
      { "idempotency-key": randomUUID() },
    );
    expect(conformance.statusCode).toBe(409);
    expect(
      await w.t.db
        .selectFrom("operations")
        .select("id")
        .where("job_id", "=", a.job.id)
        .where("type", "=", "conditions.extract")
        .execute(),
    ).toHaveLength(1);
  });

  it("a client of B reaches B but nothing of A (grants are per job)", async () => {
    expect((await call(clientOfB, "GET", `/v1/jobs/${b.job.id}`)).statusCode).toBe(200);
    for (const url of [`/v1/jobs/${a.job.id}`, `/v1/files/${a.file.id}`, `/v1/operations/${a.op.id}`])
      expect((await call(clientOfB, "GET", url)).statusCode, url).toBe(404);
  });
});

describe("visibility is evaluated on every request", () => {
  const fresh = async (grantStatus: "active" | "pending" | "revoked") => {
    const job = await w.f.makeJob();
    const user = await signIn(w.t, await w.f.makeUser({ role: "external" }));
    const grant = await w.f.makeGrant({ jobId: job.id, userId: user.user.id, status: grantStatus });
    return { job, user, grant };
  };

  it("a pending or revoked grant gives no access", async () => {
    for (const status of ["pending", "revoked"] as const) {
      const { job, user } = await fresh(status);
      expect((await call(user, "GET", `/v1/jobs/${job.id}`)).statusCode, status).toBe(404);
    }
  });

  it("revoking a grant closes the door on the very next request of the same session, files included", async () => {
    const { job, user, grant } = await fresh("active");
    const file = await seedFile(w.t, w.f, { jobId: job.id, data: pdfBytes() });
    expect((await call(user, "GET", `/v1/files/${file.id}/content`)).statusCode).toBe(200);
    await call(w.actors.staff, "DELETE", `/v1/access-grants/${grant.id}`);
    for (const url of [`/v1/jobs/${job.id}`, `/v1/files/${file.id}`, `/v1/files/${file.id}/content`])
      expect((await call(user, "GET", url)).statusCode, url).toBe(404);
  });

  it("an archived job is a 404 for everyone, admin included, on every job-scoped route", async () => {
    const job = await w.f.makeJob({ deletedAt: new Date() });
    for (const who of [w.actors.admin, w.actors.staff]) {
      for (const url of [`/v1/jobs/${job.id}`, `/v1/jobs/${job.id}/notes`, `/v1/jobs/${job.id}/package`])
        expect((await call(who, "GET", url)).statusCode, url).toBe(404);
      expect((await call(who, "PATCH", `/v1/jobs/${job.id}`, { address: "1 A St" }, V1)).statusCode).toBe(404);
    }
  });
});

describe("mass assignment: bodies name only the fields the contract allows", () => {
  it.each([
    ["PATCH", "/v1/jobs/{job}", { address: "1 A St", deletedAt: null, version: 99, createdBy: null }, V1],
    ["POST", "/v1/jobs/{job}/notes", { body: "x", authorId: UNKNOWN }, {}],
    ["PATCH", "/v1/jobs/{job}/conditions/{cond}", { isCleared: true, jobId: UNKNOWN }, V1],
    ["PATCH", "/v1/users/{user}", { role: "staff", entraObjectId: UNKNOWN }, {}],
    ["POST", "/v1/access-grants", { email: "x@example.test", role: "client", jobId: "{job}", status: "active" }, {}],
  ] as const)("%s %s: unknown fields are a 400", async (method, url, body, headers) => {
    const fill = (text: string) =>
      text.replace("{job}", a.job.id).replace("{cond}", a.condition.id).replace("{user}", w.actors.client.user.id);
    const sent = JSON.parse(fill(JSON.stringify(body))) as unknown;
    const res = await call(w.actors.admin, method, fill(url), sent, { ...headers, "idempotency-key": randomUUID() });
    expect(res.statusCode).toBe(400);
  });

  it("a client cannot make themselves anything: no route takes a role from a non-admin", async () => {
    const res = await call(w.actors.client, "PATCH", `/v1/users/${w.actors.client.user.id}`, { role: "admin" });
    expect(res.statusCode).toBe(403);
    expect(
      (
        await w.t.db
          .selectFrom("users")
          .select("role")
          .where("id", "=", w.actors.client.user.id)
          .executeTakeFirstOrThrow()
      ).role,
    ).toBe("external");
  });
});
