/** The access-manager operations answer exactly what packages/contracts/openapi.yaml declares, success and error. */
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
import { accessModule } from "../index.js";

function conforms(operationId: string, status: number, res: LightMyRequestResponse): void {
  expect(res.statusCode, operationId).toBe(status);
  if (status === 204) return;
  const type = status >= 400 ? "application/problem+json" : "application/json";
  expect(contractViolations(operationId, status, res.json(), type), `${operationId} ${status}`).toEqual([]);
}

describe("access module contract", () => {
  let t: TestApp;
  let staff: SignedIn, client: SignedIn;
  let jobId: string;
  const grant = (as: SignedIn | undefined, body: unknown, csrf?: null) =>
    apiRequest(t, {
      method: "POST",
      url: "/v1/access-grants",
      body,
      ...(as ? { as } : {}),
      ...(csrf === null ? { csrf } : {}),
    });
  const revoke = (as: SignedIn | undefined, id: string) =>
    apiRequest(t, { method: "DELETE", url: `/v1/access-grants/${id}`, ...(as ? { as } : {}) });
  const list = (as: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/access-grants${query}`, ...(as ? { as } : {}) });
  const body = (email: string) => ({ email, displayName: "Pat", role: "architect", jobId });

  beforeAll(async () => {
    t = await createTestApp();
    const f: Factories = createFactories(t.db);
    [staff, client] = [
      await signIn(t, await f.makeUser({ role: "staff" })),
      await signIn(t, await f.makeUser({ role: "external" })),
    ];
    jobId = (await f.makeJob()).id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers all three operations through defineRoute", () => {
    for (const id of accessModule.operations) expect(registeredOperations(t.app), id).toContain(id);
  });

  it("createAccessGrant conforms: 201, 400, 401, 403, 404, 409", async () => {
    conforms("createAccessGrant", 201, await grant(staff, body("a@example.test")));
    conforms("createAccessGrant", 400, await grant(staff, body("not-an-email")));
    conforms("createAccessGrant", 401, await grant(undefined, body("b@example.test")));
    conforms("createAccessGrant", 403, await grant(client, body("b@example.test")));
    conforms("createAccessGrant", 403, await grant(staff, body("b@example.test"), null));
    conforms(
      "createAccessGrant",
      404,
      await grant(staff, { ...body("b@example.test"), jobId: "0f8fad5b-d9cb-469f-a165-70867728950e" }),
    );
    conforms("createAccessGrant", 409, await grant(staff, body("a@example.test")));
  });

  it("listAccessGrants conforms: 200 with a next cursor, 400, 401, 403", async () => {
    await grant(staff, body("c@example.test"));
    const page = await list(staff, `?jobId=${jobId}&limit=1`);
    conforms("listAccessGrants", 200, page);
    expect(page.json<{ nextCursor: string | null }>().nextCursor).not.toBeNull();
    conforms("listAccessGrants", 400, await list(staff, "?cursor=nope"));
    conforms("listAccessGrants", 401, await list(undefined));
    conforms("listAccessGrants", 403, await list(client));
  });

  it("revokeAccessGrant conforms: 204, 401, 403, 404", async () => {
    const id = (await grant(staff, body("d@example.test"))).json<{ id: string }>().id;
    conforms("revokeAccessGrant", 401, await revoke(undefined, id));
    conforms("revokeAccessGrant", 403, await revoke(client, id));
    conforms("revokeAccessGrant", 204, await revoke(staff, id));
    conforms("revokeAccessGrant", 404, await revoke(staff, "0f8fad5b-d9cb-469f-a165-70867728950e"));
  });
});
