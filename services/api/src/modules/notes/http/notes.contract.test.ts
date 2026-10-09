/** The notes operations answer exactly what packages/contracts/openapi.yaml declares, success and error. */
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
import { notesModule } from "../index.js";

function conforms(operationId: string, status: number, res: LightMyRequestResponse): void {
  expect(res.statusCode, operationId).toBe(status);
  if (status === 204) return;
  const type = status >= 400 ? "application/problem+json" : "application/json";
  expect(contractViolations(operationId, status, res.json(), type), `${operationId} ${status}`).toEqual([]);
}

describe("notes module contract", () => {
  let t: TestApp;
  let staff: SignedIn, client: SignedIn, outsider: SignedIn;
  let jobId: string;
  const url = (suffix = "") => `/v1/jobs/${jobId}/notes${suffix}`;
  const send = (o: { method?: "POST" | "DELETE"; path?: string; as?: SignedIn; body?: unknown; csrf?: null }) =>
    apiRequest(t, {
      url: url(o.path),
      ...(o.method ? { method: o.method } : {}),
      ...(o.as ? { as: o.as } : {}),
      ...(o.body ? { body: o.body } : {}),
      ...(o.csrf === null ? { csrf: null } : {}),
    });

  beforeAll(async () => {
    t = await createTestApp();
    const f: Factories = createFactories(t.db);
    [staff, client, outsider] = [
      await signIn(t, await f.makeUser({ role: "staff" })),
      await signIn(t, await f.makeUser({ role: "external" })),
      await signIn(t, await f.makeUser({ role: "external" })),
    ];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers all three operations through defineRoute", () => {
    for (const id of notesModule.operations) expect(registeredOperations(t.app), id).toContain(id);
  });

  it("createNote, listNotes and deleteNote conform on success and on every declared error", async () => {
    const note = (op: LightMyRequestResponse) => op.json<{ id: string }>().id;
    conforms("createNote", 201, await send({ method: "POST", as: client, body: { body: "hello" } }));
    conforms("createNote", 400, await send({ method: "POST", as: client, body: { body: " " } }));
    conforms("createNote", 401, await send({ method: "POST", body: { body: "x" } }));
    conforms("createNote", 403, await send({ method: "POST", as: client, csrf: null, body: { body: "x" } }));
    conforms("createNote", 404, await send({ method: "POST", as: outsider, body: { body: "x" } }));

    await send({ method: "POST", as: staff, body: { body: "second" } });
    const page = await send({ path: "?limit=1", as: client });
    conforms("listNotes", 200, page);
    expect(page.json<{ nextCursor: string | null }>().nextCursor).not.toBeNull();
    conforms("listNotes", 400, await send({ path: "?cursor=nope", as: client }));
    conforms("listNotes", 401, await send({}));
    conforms("listNotes", 404, await send({ as: outsider }));

    const own = note(await send({ method: "POST", as: client, body: { body: "own" } }));
    const theirs = note(await send({ method: "POST", as: staff, body: { body: "theirs" } }));
    conforms("deleteNote", 401, await send({ method: "DELETE", path: `/${own}` }));
    conforms("deleteNote", 403, await send({ method: "DELETE", path: `/${theirs}`, as: client }));
    conforms("deleteNote", 204, await send({ method: "DELETE", path: `/${own}`, as: client }));
    conforms("deleteNote", 404, await send({ method: "DELETE", path: `/${own}`, as: client }));
  });
});
