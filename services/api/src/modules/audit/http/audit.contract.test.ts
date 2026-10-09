/** listAuditEvents answers exactly what packages/contracts/openapi.yaml declares, success and error. */
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  createTestApp,
  signIn,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";
import { registeredOperations } from "../../../app.js";
import { auditModule } from "../index.js";

function conforms(status: number, res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(status);
  const type = status >= 400 ? "application/problem+json" : "application/json";
  expect(contractViolations("listAuditEvents", status, res.json(), type), `${status}`).toEqual([]);
}

describe("audit module contract", () => {
  let t: TestApp;
  let krAdmin: SignedIn, staff: SignedIn;
  const list = (as: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/audit-events${query}`, ...(as ? { as } : {}) });

  beforeAll(async () => {
    t = await createTestApp();
    const f = createFactories(t.db);
    [krAdmin, staff] = [
      await signIn(t, await f.makeUser({ role: "kr_admin" })),
      await signIn(t, await f.makeUser({ role: "staff" })),
    ];
    // Two audited writes, so there is more than one page.
    for (const email of ["a@example.test", "b@example.test"]) {
      await apiRequest(t, {
        method: "POST",
        url: "/v1/access-grants",
        as: krAdmin,
        body: { email, role: "client", jobId: (await f.makeJob()).id },
      });
    }
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers listAuditEvents through defineRoute", () => {
    for (const id of auditModule.operations) expect(registeredOperations(t.app), id).toContain(id);
  });

  it("conforms: 200 with a next cursor, with filters and with a date range, 400, 401, 403", async () => {
    const page = await list(krAdmin, "?limit=1");
    conforms(200, page);
    const { items, nextCursor } = page.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(items).toHaveLength(1);
    expect(nextCursor).not.toBeNull();
    conforms(200, await list(krAdmin, `?actorId=${krAdmin.user.id}&action=access_grant.&cursor=${nextCursor}`));
    conforms(400, await list(krAdmin, "?cursor=nope"));
    conforms(400, await list(krAdmin, "?actorId=not-a-uuid"));
    conforms(200, await list(krAdmin, "?from=2026-01-01&to=2026-12-31"));
    conforms(400, await list(krAdmin, "?from=2026-02-01&to=2026-01-01"));
    conforms(401, await list(undefined));
    conforms(403, await list(staff));
  });
});
