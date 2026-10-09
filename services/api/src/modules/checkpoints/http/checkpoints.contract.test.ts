/** Every checkpoints-module operation answers exactly what packages/contracts/openapi.yaml declares, success and error. */
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
import { checkpointsModule } from "../index.js";

function conforms(operationId: string, res: LightMyRequestResponse): void {
  const problem = res.statusCode >= 400;
  const contentType = problem ? "application/problem+json" : "application/json";
  expect(
    contractViolations(operationId, res.statusCode, res.json(), contentType),
    `${operationId} ${res.statusCode}`,
  ).toEqual([]);
  expect(res.headers["content-type"]).toContain(contentType);
}

describe("checkpoints module contract", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, architect: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const cp = (key: string, suffix = "") => `/v1/jobs/${jobId}/checkpoints/${key}${suffix}`;
  const send = (op: {
    method: "PATCH" | "PUT" | "DELETE";
    url: string;
    as?: SignedIn;
    body?: unknown;
    ifMatch?: string;
  }) =>
    apiRequest(t, {
      method: op.method,
      url: op.url,
      ...(op.as ? { as: op.as } : {}),
      ...(op.body === undefined ? {} : { body: op.body }),
      ...(op.ifMatch ? { headers: { "if-match": op.ifMatch } } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff, client, architect, outsider] = [
      await as("admin"),
      await as("staff"),
      await as("external"),
      await as("external"),
      await as("external"),
    ];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    await f.makeGrant({ jobId, userId: architect.user.id, role: "architect" });
    await f.makeFile({ jobId, checkpointKey: "i1_0p", slot: "documents" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers all four checkpoint operations through defineRoute", () => {
    for (const id of checkpointsModule.operations) expect(registeredOperations(t.app), id).toContain(id);
    expect(checkpointsModule.operations).toHaveLength(4);
  });

  it("updateCheckpoint: 200 (also for the unrestricted fee proposal), 400, 401, 403, 404, 412, 428", async () => {
    const ok = await send({
      method: "PATCH",
      url: cp("i8_3"),
      as: staff,
      body: { status: "completed", krNote: "n" },
      ifMatch: '"1"',
    });
    expect(ok.statusCode).toBe(200);
    conforms("updateCheckpoint", ok);
    const fee = await send({
      method: "PATCH",
      url: cp("i1_0p"),
      as: admin,
      body: { responsibility: "kr" },
      ifMatch: '"1"',
    });
    expect(fee.statusCode).toBe(200);
    conforms("updateCheckpoint", fee);
    const cases = [
      [400, { as: staff, body: {}, ifMatch: '"2"' }],
      [401, { body: { status: "completed" }, ifMatch: '"2"' }],
      [403, { as: client, body: { status: "completed" }, ifMatch: '"2"' }],
      [404, { as: outsider, body: { status: "completed" }, ifMatch: '"2"' }],
      [412, { as: staff, body: { status: "not_completed" }, ifMatch: '"1"' }],
      [428, { as: staff, body: { status: "not_completed" } }],
    ] as const;
    for (const [status, req] of cases) {
      const res = await send({ method: "PATCH", url: cp("i8_3"), ...req });
      expect(res.statusCode, String(status)).toBe(status);
      conforms("updateCheckpoint", res);
    }
  });

  it("recordDecision: 200 for the client (and the restricted fee proposal view for none), 400, 401, 403, 404, 409", async () => {
    const ok = await send({
      method: "PUT",
      url: cp("i3_0p", "/decision"),
      as: client,
      body: { value: "declined", comment: "No" },
    });
    expect(ok.statusCode).toBe(200);
    conforms("recordDecision", ok);
    const cases = [
      [400, { as: client, body: { value: "declined" } }],
      [401, { body: { value: "accepted" } }],
      [403, { as: architect, body: { value: "accepted" } }],
      [404, { as: outsider, body: { value: "accepted" } }],
    ] as const;
    for (const [status, req] of cases) {
      const res = await send({ method: "PUT", url: cp("i3_0p", "/decision"), ...req });
      expect(res.statusCode, String(status)).toBe(status);
      conforms("recordDecision", res);
    }
    const noPanel = await send({ method: "PUT", url: cp("i2_0", "/decision"), as: staff, body: { value: "accepted" } });
    expect(noPanel.statusCode).toBe(409);
    conforms("recordDecision", noPanel);
  });

  it("markPaid and undoPaid: 200, 401, 403, 404 and (markPaid) 409", async () => {
    const paid = await send({ method: "PUT", url: cp("i14_0", "/paid"), as: client });
    expect(paid.statusCode).toBe(200);
    conforms("markPaid", paid);
    expect(paid.json<{ paid: unknown }>().paid).not.toBeNull();
    for (const [status, who] of [
      [401, undefined],
      [403, architect],
      [404, outsider],
    ] as const) {
      const res = await send({ method: "PUT", url: cp("i14_0", "/paid"), ...(who ? { as: who } : {}) });
      expect(res.statusCode, `markPaid ${status}`).toBe(status);
      conforms("markPaid", res);
    }
    const noButton = await send({ method: "PUT", url: cp("i2_0", "/paid"), as: staff });
    expect(noButton.statusCode).toBe(409);
    conforms("markPaid", noButton);

    const undone = await send({ method: "DELETE", url: cp("i14_0", "/paid"), as: staff });
    expect(undone.statusCode).toBe(200);
    conforms("undoPaid", undone);
    expect(undone.json<{ paid: unknown; status: string }>()).toMatchObject({ paid: null, status: "not_completed" });
    for (const [status, who] of [
      [401, undefined],
      [403, architect],
      [404, outsider],
    ] as const) {
      const res = await send({ method: "DELETE", url: cp("i14_0", "/paid"), ...(who ? { as: who } : {}) });
      expect(res.statusCode, `undoPaid ${status}`).toBe(status);
      conforms("undoPaid", res);
    }
  });
});
