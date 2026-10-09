/** Every conditions-module operation answers exactly what packages/contracts/openapi.yaml declares, success and error. */
import { enqueueOperation } from "@kr/db";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { conditionsModule } from "../index.js";

function conforms(operationId: string, res: LightMyRequestResponse): void {
  const problem = res.statusCode >= 400;
  const contentType = problem ? "application/problem+json" : "application/json";
  expect(
    contractViolations(operationId, res.statusCode, res.json(), contentType),
    `${operationId} ${res.statusCode}`,
  ).toEqual([]);
  expect(res.headers["content-type"]).toContain(contentType);
}

describe("conditions module contract", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn, client: SignedIn, outsider: SignedIn;
  let jobId: string;
  let conditionId: string;
  let letterId: string;
  let noticeId: string;
  let keyCounter = 0;
  const key = () => ({ "idempotency-key": `contract-key-${++keyCounter}-xxxxxxxx` });
  const as = async (role: "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const post = (url: string, who: SignedIn | undefined, body: unknown, headers: Record<string, string> = key()) =>
    apiRequest(t, { method: "POST", url: `/v1/jobs/${jobId}/${url}`, ...(who ? { as: who } : {}), body, headers });
  const patch = (who: SignedIn | undefined, body: unknown, ifMatch?: string) =>
    apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${jobId}/conditions/${conditionId}`,
      ...(who ? { as: who } : {}),
      body,
      ...(ifMatch ? { headers: { "if-match": ifMatch } } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [staff, client, outsider] = [await as("staff"), await as("external"), await as("external")];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    conditionId = (await f.makeCondition({ jobId, number: 1 })).id;
    letterId = (await f.makeFile({ jobId, checkpointKey: "i5_0", slot: "decision", name: "Decision Letter.pdf" })).id;
    noticeId = (await f.makeFile({ jobId, checkpointKey: "i4_2", slot: "conformance", name: "notice.pdf" })).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers all three conditions operations through defineRoute", () => {
    for (const id of conditionsModule.operations) expect(registeredOperations(t.app), id).toContain(id);
    expect(conditionsModule.operations).toHaveLength(3);
  });

  it("startConditionsExtraction: 202 (also on replay), 400, 401, 403, 404, 409", async () => {
    const headers = key();
    const ok = await post("conditions/extractions", staff, { fileId: letterId, replaceExisting: true }, headers);
    expect(ok.statusCode).toBe(202);
    conforms("startConditionsExtraction", ok);
    const replay = await post("conditions/extractions", staff, { fileId: letterId, replaceExisting: true }, headers);
    expect(replay.statusCode).toBe(202);
    conforms("startConditionsExtraction", replay);
    const cases = [
      [400, staff, { fileId: "nope" }],
      [400, staff, { fileId: letterId }, {}],
      [401, undefined, { fileId: letterId }],
      [403, client, { fileId: letterId }],
      [404, outsider, { fileId: letterId }],
      [409, staff, { fileId: letterId }],
      [409, staff, { fileId: noticeId, replaceExisting: true }],
    ] as const;
    for (const [status, who, body, headers] of cases) {
      const res = await post("conditions/extractions", who, body, headers);
      expect(res.statusCode, String(status)).toBe(status);
      conforms("startConditionsExtraction", res);
    }
  });

  it("startConformanceReading: 202, 400, 401, 403, 404, 409", async () => {
    const ok = await post("conformance-readings", staff, { fileId: noticeId });
    expect(ok.statusCode).toBe(202);
    conforms("startConformanceReading", ok);
    const cases = [
      [400, staff, { fileId: noticeId, extra: 1 }],
      [401, undefined, { fileId: noticeId }],
      [403, client, { fileId: noticeId }],
      [404, outsider, { fileId: noticeId }],
      [409, staff, { fileId: letterId }],
    ] as const;
    for (const [status, who, body] of cases) {
      const res = await post("conformance-readings", who, body);
      expect(res.statusCode, String(status)).toBe(status);
      conforms("startConformanceReading", res);
    }
  });

  it("updateCondition: 200, 400, 401, 403, 404, 412, 428", async () => {
    const ok = await patch(staff, { isCleared: true, krComment: "Done" }, '"1"');
    expect(ok.statusCode).toBe(200);
    conforms("updateCondition", ok);
    const comment = await patch(client, { clientComment: "Receipt sent" }, '"2"');
    expect(comment.statusCode).toBe(200);
    conforms("updateCondition", comment);
    const cases = [
      [400, staff, {}, '"3"'],
      [401, undefined, { krComment: "x" }, '"3"'],
      [403, client, { isCleared: false }, '"3"'],
      [404, outsider, { clientComment: "x" }, '"3"'],
      [412, staff, { krComment: "x" }, '"1"'],
      [428, staff, { krComment: "x" }, undefined],
    ] as const;
    for (const [status, who, body, ifMatch] of cases) {
      const res = await patch(who, body, ifMatch);
      expect(res.statusCode, String(status)).toBe(status);
      conforms("updateCondition", res);
    }
    const gone = await f.makeCondition({ jobId, number: 2 });
    await t.db.updateTable("conditions").set({ superseded_at: t.deps.clock.now() }).where("id", "=", gone.id).execute();
    const superseded = await apiRequest(t, {
      method: "PATCH",
      url: `/v1/jobs/${jobId}/conditions/${gone.id}`,
      as: staff,
      body: { krComment: "x" },
      headers: { "if-match": '"1"' },
    });
    expect(superseded.statusCode).toBe(404);
    conforms("updateCondition", superseded);
  });

  it("the operations it queued are pollable by getOperation (Location points at a 200)", async () => {
    const queued = await enqueueOperation(t.db, { jobId, type: "conformance.read", payload: {}, createdBy: null });
    const res = await apiRequest(t, { url: `/v1/operations/${queued.id}`, as: client });
    expect(res.statusCode).toBe(200);
    conforms("getOperation", res);
  });
});
