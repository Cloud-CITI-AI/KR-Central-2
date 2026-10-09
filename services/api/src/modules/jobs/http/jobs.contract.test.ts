/** Every jobs-module operation answers exactly what packages/contracts/openapi.yaml declares, success and error. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  createTestApp,
  signIn,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { registeredOperations } from "../../../app.js";
import { jobsModule } from "../index.js";

const openapi = parse(
  readFileSync(fileURLToPath(new URL("../../../../../../packages/contracts/openapi.yaml", import.meta.url)), "utf8"),
) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };

function conforms(operationId: string, res: LightMyRequestResponse): void {
  const problem = res.statusCode >= 400;
  const contentType = problem ? "application/problem+json" : "application/json";
  expect(
    contractViolations(operationId, res.statusCode, res.json(), contentType),
    `${operationId} ${res.statusCode}`,
  ).toEqual([]);
  expect(res.headers["content-type"]).toContain(contentType);
}

describe("jobs module contract", () => {
  let t: TestApp;
  let f: Factories;
  let tag: string;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const send = (op: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    as?: SignedIn;
    body?: unknown;
    ifMatch?: string;
  }) =>
    apiRequest(t, {
      method: op.method ?? "GET",
      url: op.url,
      ...(op.as ? { as: op.as } : {}),
      ...(op.body === undefined ? {} : { body: op.body }),
      ...(op.ifMatch ? { headers: { "if-match": op.ifMatch } } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    tag = `K${f.faker.string.alphanumeric(5).toUpperCase()}`;
    [admin, staff, client, architect, outsider] = [
      await as("admin"),
      await as("staff"),
      await as("external"),
      await as("external"),
      await as("external"),
    ];
    const job = await f.makeJob({ jobNumber: `${tag}-1` });
    jobId = job.id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
    await f.makeFile({ jobId, checkpointKey: "i1_0p", slot: "documents" });
    await f.makeCondition({ jobId, number: 1, agency: "Western Power" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers all six jobs operations through defineRoute", () => {
    for (const id of jobsModule.operations) expect(registeredOperations(t.app), id).toContain(id);
    expect(jobsModule.operations).toHaveLength(6);
  });

  it("listJobs: 200 for every caller kind, 400 for a bad query or cursor, 401 without a session", async () => {
    for (const who of [admin, staff, client, architect, outsider]) {
      conforms("listJobs", await send({ url: `/v1/jobs?status=all&q=${tag}`, as: who }));
    }
    const page = await send({ url: `/v1/jobs?status=all&q=${tag}&limit=1`, as: admin });
    expect(page.json<{ items: unknown[] }>().items).toHaveLength(1);
    for (const url of ["/v1/jobs?limit=1000", "/v1/jobs?cursor=bogus", "/v1/jobs?status=nope", "/v1/jobs?extra=1"]) {
      const res = await send({ url, as: admin });
      expect(res.statusCode, url).toBe(400);
      conforms("listJobs", res);
    }
    const anon = await send({ url: "/v1/jobs" });
    expect(anon.statusCode).toBe(401);
    conforms("listJobs", anon);
  });

  it("getJobFacets: 200 for every caller kind, 400 for a bad status, 401 without a session", async () => {
    for (const who of [admin, staff, client, architect, outsider])
      conforms("getJobFacets", await send({ url: "/v1/jobs/facets", as: who }));
    const bad = await send({ url: "/v1/jobs/facets?status=nope", as: admin });
    expect(bad.statusCode).toBe(400);
    conforms("getJobFacets", bad);
    conforms("getJobFacets", await send({ url: "/v1/jobs/facets" }));
  });

  it("createJob: 201 with Location and ETag, 400, 401, 403 and 409", async () => {
    const body = { jobNumber: `${tag}-2`, address: "3 Contract Lane, Testville", subdivisionType: "Freehold" };
    const created = await send({ method: "POST", url: "/v1/jobs", as: staff, body });
    expect(created.statusCode).toBe(201);
    conforms("createJob", created);
    expect(created.headers.location).toMatch(/^\/v1\/jobs\/[0-9a-f-]{36}$/);
    expect(created.headers.etag).toBe('"1"');
    const dup = await send({ method: "POST", url: "/v1/jobs", as: admin, body });
    expect(dup.statusCode).toBe(409);
    conforms("createJob", dup);
    const invalid = await send({
      method: "POST",
      url: "/v1/jobs",
      as: staff,
      body: { ...body, subdivisionType: "Bogus" },
    });
    expect(invalid.statusCode).toBe(400);
    conforms("createJob", invalid);
    const forbidden = await send({ method: "POST", url: "/v1/jobs", as: client, body });
    expect(forbidden.statusCode).toBe(403);
    conforms("createJob", forbidden);
    const anon = await send({ method: "POST", url: "/v1/jobs", body });
    expect(anon.statusCode).toBe(401);
    conforms("createJob", anon);
  });

  it("getJob: 200 with an ETag for staff, client and architect (fee proposal restricted or not), 400, 401, 404", async () => {
    for (const who of [admin, staff, client, architect]) {
      const res = await send({ url: `/v1/jobs/${jobId}`, as: who });
      expect(res.statusCode).toBe(200);
      conforms("getJob", res);
      expect(res.headers.etag).toMatch(/^"\d+"$/);
    }
    const restricted = (await send({ url: `/v1/jobs/${jobId}`, as: staff })).json<{
      checkpoints: { key: string; isRestricted: boolean }[];
    }>();
    expect(restricted.checkpoints.find((c) => c.key === "i1_0p")?.isRestricted).toBe(true);
    for (const [url, who, status] of [
      ["/v1/jobs/not-a-uuid", admin, 400],
      [`/v1/jobs/${jobId}`, undefined, 401],
      [`/v1/jobs/${jobId}`, outsider, 404],
      ["/v1/jobs/0f8fad5b-d9cb-469f-a165-70867728950e", admin, 404],
    ] as const) {
      const res = await send({ url, ...(who ? { as: who } : {}) });
      expect(res.statusCode, url).toBe(status);
      conforms("getJob", res);
    }
  });

  it("updateJob: 200, 400, 401, 403, 404, 409, 412 and 428", async () => {
    const mine = await f.makeJob({ jobNumber: `${tag}-3` });
    await f.makeGrant({ jobId: mine.id, userId: client.user.id, role: "client" });
    const url = `/v1/jobs/${mine.id}`;
    const ok = await send({ method: "PATCH", url, as: staff, body: { address: "5 Updated Rd" }, ifMatch: '"1"' });
    expect(ok.statusCode).toBe(200);
    conforms("updateJob", ok);
    expect(ok.headers.etag).toBe('"2"');
    const cases = [
      [400, { as: staff, body: {}, ifMatch: '"2"' }],
      [401, { body: { address: "x" }, ifMatch: '"2"' }],
      [403, { as: client, body: { address: "x" }, ifMatch: '"2"' }],
      [404, { as: outsider, body: { address: "x" }, ifMatch: '"2"' }],
      [409, { as: staff, body: { jobNumber: `${tag}-1` }, ifMatch: '"2"' }],
      [412, { as: staff, body: { address: "x" }, ifMatch: '"1"' }],
      [428, { as: staff, body: { address: "x" } }],
    ] as const;
    for (const [status, req] of cases) {
      const res = await send({ method: "PATCH", url, ...req });
      expect(res.statusCode, String(status)).toBe(status);
      conforms("updateJob", res);
    }
  });

  it("deleteJob: 204 declared and returned with no body; 401, 403, 404, 412 and 428 as problems", async () => {
    expect(openapi.paths["/v1/jobs/{jobId}"]?.delete?.responses).toHaveProperty("204");
    const mine = await f.makeJob({ jobNumber: `${tag}-4` });
    const url = `/v1/jobs/${mine.id}`;
    const cases = [
      [401, { ifMatch: '"1"' }],
      [403, { as: staff, ifMatch: '"1"' }],
      [404, { as: outsider, ifMatch: '"1"' }],
      [412, { as: admin, ifMatch: '"9"' }],
      [428, { as: admin }],
    ] as const;
    for (const [status, req] of cases) {
      const res = await send({ method: "DELETE", url, ...req });
      expect(res.statusCode, String(status)).toBe(status);
      conforms("deleteJob", res);
    }
    const archived = await send({ method: "DELETE", url, as: admin, ifMatch: '"1"' });
    expect(archived.statusCode).toBe(204);
    expect(archived.body).toBe("");
    const gone = await send({ method: "DELETE", url, as: admin, ifMatch: '"2"' });
    expect(gone.statusCode).toBe(404);
    conforms("deleteJob", gone);
  });
});
