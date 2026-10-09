/**
 * PRODUCT_SPEC 2.1 as a table: every capability row, driven through the operations that exercise it, for every caller.
 * The expectations are written out here from the spec (not read from @kr/contracts), so a drift between the spec, the
 * permission table and the handlers fails a test. Outcomes: allowed = the success status; a caller who can see the job
 * but lacks the capability = 403 (404 where the spec hides the thing itself); a caller who cannot see the job = 404
 * (jobs) or 403 (global capabilities); a disabled user = 401 (the session ends with the account).
 * Paths and bodies may hold {placeholders}; the fixture behind each is created per call, on the call's own job.
 */
import { randomUUID } from "node:crypto";
import { ROUTES, type OperationId } from "@kr/contracts";
import { enqueueOperation } from "@kr/db";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfBytes, pngBytes, seedFile, uploadFile } from "../../src/modules/files/testing.js";
import { apiRequest, signIn } from "../helpers/index.js";
import { ROLES, createWorld, type Actors, type RoleName, type World } from "./support.js";

const STAFF = ["admin", "kr_admin", "staff"] as const;
const WITH_CLIENT = [...STAFF, "client"] as const;
const EVERYONE = [...WITH_CLIENT, "architect"] as const;
const FEE_VIEWERS = ["admin", "kr_admin", "client"] as const;
const ADMINS = ["admin", "kr_admin"] as const;

interface Ctx {
  readonly w: World;
  readonly jobId: string;
  readonly who: Actors[RoleName];
}
type Run = (c: Ctx) => Promise<LightMyRequestResponse>;
interface Case {
  readonly row: string;
  readonly op: OperationId;
  readonly allow: readonly RoleName[];
  readonly ok: number;
  readonly run: Run;
  /** Outcome for a caller who sees the job but lacks the capability (403, or 404 where the spec hides the thing). */
  readonly denied: number;
  /** A caller without the capability gets 403 even with no grant (there is no job to hide). */
  readonly global: boolean;
}
const row = (
  r: string,
  op: OperationId,
  allow: readonly RoleName[],
  ok: number,
  run: Run,
  o: Partial<Case> = {},
): Case => ({
  row: r,
  op,
  allow,
  ok,
  run,
  denied: 403,
  global: false,
  ...o,
});

const seed = (c: Ctx, o: Partial<Parameters<typeof seedFile>[2]> = {}) =>
  seedFile(c.w.t, c.w.f, { jobId: c.jobId, data: pdfBytes(), ...o }).then((f) => f.id);
const stranger = (c: Ctx) => c.w.f.makeUser({ role: "staff" }).then((u) => u.id);
const note = (c: Ctx, authorId: string) => c.w.f.makeNote({ jobId: c.jobId, authorId }).then((n) => n.id);
const FIXTURES: Record<string, (c: Ctx) => Promise<string>> = {
  job: (c) => Promise.resolve(c.jobId),
  cond: (c) => c.w.f.makeCondition({ jobId: c.jobId, number: 1 }).then((x) => x.id),
  file: (c) => seed(c),
  feefile: (c) => seed(c, { checkpointKey: "i1_0p", slot: "documents" }),
  ownfile: (c) => seed(c, { uploadedBy: c.who.user.id }),
  otherfile: async (c) => seed(c, { uploadedBy: await stranger(c) }),
  decisionfile: (c) => seed(c, { checkpointKey: "i5_0", slot: "decision", name: "Decision Letter.pdf" }),
  conformfile: (c) => seed(c, { checkpointKey: "i4_2", slot: "conformance" }),
  ownnote: (c) => note(c, c.who.user.id),
  othernote: async (c) => note(c, await stranger(c)),
  grant: (c) => c.w.f.makeGrant({ jobId: c.jobId, status: "pending" }).then((g) => g.id),
  user: stranger,
  jobnumber: () => Promise.resolve(`M${randomUUID().slice(0, 12)}`),
  op: (c) =>
    enqueueOperation(c.w.t.db, { jobId: c.jobId, type: "conditions.extract", payload: {}, createdBy: null }).then(
      (o) => o.id,
    ),
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Fill every {placeholder} of `text` with a fixture made for this call. */
async function fill(c: Ctx, text: string): Promise<string> {
  let out = text;
  for (const name of new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""))) {
    const make = FIXTURES[name];
    if (!make) throw new RangeError(`unknown placeholder ${name}`);
    out = out.replaceAll(`{${name}}`, await make(c));
  }
  return out;
}
const V1 = { "if-match": '"1"' };
const send =
  (method: Method, path: string, body?: unknown, headers: Record<string, string> = {}): Run =>
  async (c) => {
    const bodyText = body === undefined ? undefined : await fill(c, JSON.stringify(body));
    return apiRequest(c.w.t, {
      method,
      url: await fill(c, path),
      as: c.who,
      ...(bodyText === undefined ? {} : { body: JSON.parse(bodyText) as unknown }),
      headers: { ...headers, ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
    });
  };
const up =
  (fields: Record<string, string>, name = "plan.pdf", data = pdfBytes()): Run =>
  async (c) =>
    uploadFile(c.w.t, {
      jobId: c.jobId,
      as: c.who,
      fields: JSON.parse(await fill(c, JSON.stringify(fields))) as Record<string, string>,
      file: { name, data },
    });
const get = (path: string) => send("GET", path);
const patchCp = (key: string, body: unknown) => send("PATCH", `/v1/jobs/{job}/checkpoints/${key}`, body, V1);
const patchCond = (body: unknown) => send("PATCH", "/v1/jobs/{job}/conditions/{cond}", body, V1);

const CASES: readonly Case[] = [
  // See dashboard / job list, and everything a job reader can open
  row("dashboard", "listJobs", [...EVERYONE, "outsider"], 200, get("/v1/jobs")),
  row("dashboard", "getJobFacets", [...EVERYONE, "outsider"], 200, get("/v1/jobs/facets")),
  row("job read", "getJob", EVERYONE, 200, get("/v1/jobs/{job}")),
  row("job read", "listNotes", EVERYONE, 200, get("/v1/jobs/{job}/notes")),
  row("job read", "getFile", EVERYONE, 200, get("/v1/files/{file}")),
  row("job read", "getFileContent", EVERYONE, 200, get("/v1/files/{file}/content")),
  row("job read", "getOperation", EVERYONE, 200, get("/v1/operations/{op}")),
  // Create job, edit job details and WAPC dates; archive
  row(
    "create job",
    "createJob",
    STAFF,
    201,
    send("POST", "/v1/jobs", {
      jobNumber: "{jobnumber}",
      address: "1 Test St, Testville WA 6000",
      subdivisionType: "Survey-Strata",
    }),
    { global: true },
  ),
  row(
    "edit job",
    "updateJob",
    STAFF,
    200,
    send("PATCH", "/v1/jobs/{job}", { address: "2 Test St, Testville WA 6000" }, V1),
  ),
  row("archive job", "deleteJob", ADMINS, 204, send("DELETE", "/v1/jobs/{job}", undefined, V1)),
  // Checkpoint edits, client decision, client response button and Undo
  row("checkpoint status", "updateCheckpoint", STAFF, 200, patchCp("i2_0", { status: "completed" })),
  row("checkpoint responsibility", "updateCheckpoint", STAFF, 200, patchCp("i2_0", { responsibility: "client" })),
  row("checkpoint KR note", "updateCheckpoint", STAFF, 200, patchCp("i8_3", { krNote: "Payable to the Shire" })),
  row(
    "client decision",
    "recordDecision",
    WITH_CLIENT,
    200,
    send("PUT", "/v1/jobs/{job}/checkpoints/i3_0p/decision", { value: "accepted" }),
  ),
  row("client response button", "markPaid", WITH_CLIENT, 200, send("PUT", "/v1/jobs/{job}/checkpoints/i6_2/paid")),
  row("client response undo", "undoPaid", WITH_CLIENT, 200, send("DELETE", "/v1/jobs/{job}/checkpoints/i6_2/paid")),
  // Fee proposal panel and files (the job view itself is checked below)
  row(
    "fee proposal panel",
    "recordDecision",
    FEE_VIEWERS,
    200,
    send("PUT", "/v1/jobs/{job}/checkpoints/i1_0p/decision", { value: "accepted" }),
  ),
  row("fee proposal panel", "updateCheckpoint", ADMINS, 200, patchCp("i1_0p", { status: "completed" })),
  row("fee proposal files", "getFile", FEE_VIEWERS, 200, get("/v1/files/{feefile}"), { denied: 404 }),
  row("fee proposal files", "getFileContent", FEE_VIEWERS, 200, get("/v1/files/{feefile}/content"), { denied: 404 }),
  row("fee proposal upload", "uploadFile", ADMINS, 201, up({ checkpointKey: "i1_0p", slot: "documents" })),
  // Uploads and removals
  row("upload staff slot", "uploadFile", STAFF, 201, up({ checkpointKey: "i2_0", slot: "survey" })),
  row("upload staff + client slot", "uploadFile", WITH_CLIENT, 201, up({ checkpointKey: "i3_0p", slot: "consent" })),
  row("upload condition evidence", "uploadFile", EVERYONE, 201, up({ conditionId: "{cond}" }, "e.png", pngBytes())),
  row("remove any file", "deleteFile", STAFF, 204, send("DELETE", "/v1/files/{otherfile}")),
  row("remove own upload", "deleteFile", EVERYONE, 204, send("DELETE", "/v1/files/{ownfile}")),
  // Extract conditions, re-read conformed date, add query emails
  row(
    "extract conditions",
    "startConditionsExtraction",
    STAFF,
    202,
    send("POST", "/v1/jobs/{job}/conditions/extractions", { fileId: "{decisionfile}" }),
  ),
  row(
    "re-read conformed date",
    "startConformanceReading",
    STAFF,
    202,
    send("POST", "/v1/jobs/{job}/conformance-readings", { fileId: "{conformfile}" }),
  ),
  row(
    "add query email",
    "pasteEmail",
    STAFF,
    201,
    send("POST", "/v1/jobs/{job}/emails", { text: "From: a@example.test\nSubject: Query\n\nPlease explain." }),
  ),
  // Conditions
  row("edit condition tick", "updateCondition", STAFF, 200, patchCond({ isCleared: true })),
  row("edit condition KR comment", "updateCondition", STAFF, 200, patchCond({ krComment: "Booked" })),
  row("edit condition responsibility", "updateCondition", STAFF, 200, patchCond({ responsibility: "client" })),
  row("edit condition agency", "updateCondition", STAFF, 200, patchCond({ agency: "Water Corporation" })),
  row("edit client comment", "updateCondition", EVERYONE, 200, patchCond({ clientComment: "Done" })),
  // Notes, package
  row("add note", "createNote", EVERYONE, 201, send("POST", "/v1/jobs/{job}/notes", { body: "A note" })),
  row("delete any note", "deleteNote", STAFF, 204, send("DELETE", "/v1/jobs/{job}/notes/{othernote}")),
  row("delete own note", "deleteNote", EVERYONE, 204, send("DELETE", "/v1/jobs/{job}/notes/{ownnote}")),
  row("download package", "downloadJobPackage", EVERYONE, 200, get("/v1/jobs/{job}/package")),
  // Access manager, user management, audit trail
  row("access manager", "listAccessGrants", STAFF, 200, get("/v1/access-grants"), { global: true }),
  row(
    "access manager",
    "createAccessGrant",
    STAFF,
    201,
    send("POST", "/v1/access-grants", { email: "{jobnumber}@example.test", role: "client", jobId: "{job}" }),
    { global: true },
  ),
  row("access manager", "revokeAccessGrant", STAFF, 204, send("DELETE", "/v1/access-grants/{grant}"), { global: true }),
  row("user management", "listUsers", ["admin"], 200, get("/v1/users"), { global: true }),
  row("user management", "updateUser", ["admin"], 200, send("PATCH", "/v1/users/{user}", { role: "kr_admin" }), {
    global: true,
  }),
  row("audit trail", "listAuditEvents", ADMINS, 200, get("/v1/audit-events"), { global: true }),
];

function expected(c: Case, role: RoleName): number {
  if (role === "disabled") return 401;
  if (c.allow.includes(role)) return c.ok;
  return role === "outsider" && !c.global ? 404 : c.denied;
}

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.t.close();
});

describe("PRODUCT_SPEC 2.1: every capability row for every caller", () => {
  it.each(CASES.map((c) => [`${c.row} (${c.op})`, c] as const))("%s", async (name, c) => {
    for (const role of ROLES) {
      const res = await c.run({ w, jobId: (await w.freshJob()).id, who: w.actors[role] });
      expect(res.statusCode, `${name} as ${role}: ${res.body.slice(0, 160)}`).toBe(expected(c, role));
    }
  });

  it("covers every session operation of the contract (getMe and logout are open to any signed-in user, below)", () => {
    const covered = new Set<string>([...CASES.map((c) => c.op), "getMe", "logout"]);
    expect(ROUTES.filter((r) => r.auth === "session" && !covered.has(r.operationId)).map((r) => r.operationId)).toEqual(
      [],
    );
  });

  it("getMe and logout work for every signed-in caller, whatever the role, and the session ends with logout", async () => {
    for (const role of ROLES.filter((r) => r !== "disabled")) {
      const fresh = await signIn(w.t, w.actors[role].user);
      const call = (method: Method, url: string) => apiRequest(w.t, { method, url, as: fresh });
      expect((await call("GET", "/v1/me")).statusCode, role).toBe(200);
      expect((await call("POST", "/v1/auth/logout")).statusCode, role).toBe(200);
      expect((await call("GET", "/v1/me")).statusCode, role).toBe(401);
    }
    expect((await apiRequest(w.t, { url: "/v1/me", as: w.actors.disabled })).statusCode).toBe(401);
  });
});

describe("PRODUCT_SPEC 2.1: what the dashboard and the tracker show to each caller", () => {
  const read = (role: RoleName, url: string) => apiRequest(w.t, { url, as: w.actors[role] });

  it("lists every job to staff, kr_admin and admin, only granted jobs to externals, nothing to an outsider", async () => {
    const [granted, other] = [await w.freshJob(), await w.f.makeJob()];
    const sees = async (role: RoleName, job: { job_number: string; id: string }) =>
      (await read(role, `/v1/jobs?status=all&q=${encodeURIComponent(job.job_number)}`))
        .json<{ items: { id: string }[] }>()
        .items.some((i) => i.id === job.id);
    for (const role of ROLES.filter((r) => r !== "disabled")) {
      expect(await sees(role, granted), `${role} sees the granted job`).toBe(role !== "outsider");
      expect(await sees(role, other), `${role} sees an ungranted job`).toBe(
        (STAFF as readonly string[]).includes(role),
      );
    }
  });

  it("shows the fee proposal (note and files) to admin, kr_admin and the client only", async () => {
    const job = await w.freshJob();
    const secret = "Fee note for the client only";
    await w.t.db
      .updateTable("checkpoint_states")
      .set({ kr_note: secret })
      .where("job_id", "=", job.id)
      .where("checkpoint_key", "=", "i1_0p")
      .execute();
    await seedFile(w.t, w.f, {
      jobId: job.id,
      data: pdfBytes(),
      checkpointKey: "i1_0p",
      slot: "documents",
      name: "fee-proposal.pdf",
    });
    for (const role of EVERYONE) {
      const res = await read(role, `/v1/jobs/${job.id}`);
      expect(res.statusCode, role).toBe(200);
      expect(res.body.includes(secret) || res.body.includes("fee-proposal.pdf"), role).toBe(
        FEE_VIEWERS.some((r) => r === role),
      );
    }
  });
});
