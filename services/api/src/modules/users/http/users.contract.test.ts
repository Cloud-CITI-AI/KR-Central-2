/** The user-administration operations answer exactly what packages/contracts/openapi.yaml declares, success and error. */
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
import { usersModule } from "../index.js";

function conforms(operationId: string, status: number, res: LightMyRequestResponse): void {
  expect(res.statusCode, operationId).toBe(status);
  const type = status >= 400 ? "application/problem+json" : "application/json";
  expect(contractViolations(operationId, status, res.json(), type), `${operationId} ${status}`).toEqual([]);
}

describe("users module contract", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn;
  const list = (as: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/users${query}`, ...(as ? { as } : {}) });
  const patch = (as: SignedIn | undefined, id: string, body: unknown, csrf?: null, ifMatch?: string) =>
    apiRequest(t, {
      method: "PATCH",
      url: `/v1/users/${id}`,
      body,
      ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
      ...(as ? { as } : {}),
      ...(csrf === null ? { csrf } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff] = [
      await signIn(t, await f.makeUser({ role: "admin" })),
      await signIn(t, await f.makeUser({ role: "staff" })),
    ];
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers both operations through defineRoute", () => {
    for (const id of usersModule.operations) expect(registeredOperations(t.app), id).toContain(id);
  });

  it("listUsers conforms: 200 with a next cursor, 400, 401, 403", async () => {
    const page = await list(admin, "?limit=1");
    conforms("listUsers", 200, page);
    expect(page.json<{ nextCursor: string | null }>().nextCursor).not.toBeNull();
    conforms("listUsers", 400, await list(admin, "?cursor=nope"));
    conforms("listUsers", 401, await list(undefined));
    conforms("listUsers", 403, await list(staff));
  });

  it("updateUser conforms: 200 with and without If-Match, 400, 401, 403 (role, CSRF and own account), 404, 409, 412", async () => {
    const target = await f.makeUser({ role: "staff" });
    const guest = await f.makeUser({ role: "external" });
    // If-Match is optional: no header succeeds (version 1 → 2), a current one succeeds too, a stale one is 412.
    const first = await patch(admin, target.id, { role: "kr_admin" });
    conforms("updateUser", 200, first);
    expect(first.json<{ version: number }>().version).toBe(2);
    const etag = String(first.headers.etag);
    conforms("updateUser", 200, await patch(admin, target.id, { role: "staff" }, undefined, etag));
    conforms("updateUser", 412, await patch(admin, target.id, { role: "kr_admin" }, undefined, etag));
    conforms("updateUser", 400, await patch(admin, target.id, { role: "staff" }, undefined, "3"));
    conforms("updateUser", 400, await patch(admin, target.id, {}));
    conforms("updateUser", 401, await patch(undefined, target.id, { role: "staff" }));
    conforms("updateUser", 403, await patch(staff, target.id, { role: "staff" }));
    conforms("updateUser", 403, await patch(admin, target.id, { role: "staff" }, null));
    conforms("updateUser", 403, await patch(admin, admin.user.id, { role: "staff" }));
    conforms("updateUser", 404, await patch(admin, "0f8fad5b-d9cb-469f-a165-70867728950e", { role: "staff" }));
    conforms("updateUser", 409, await patch(admin, guest.id, { role: "staff" }));
  });
});
