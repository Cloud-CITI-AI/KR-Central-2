import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../test/helpers/index.js";

const NUL_MESSAGE = "Must not contain NUL (U+0000) characters";

describe("NUL guard (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let staff: SignedIn, admin: SignedIn, client: SignedIn, guest: SignedIn;
  let jobId: string;
  let conditionId: string;

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    staff = await signIn(t, await f.makeUser({ role: "staff" }));
    admin = await signIn(t, await f.makeUser({ role: "admin" }));
    client = await signIn(t, await f.makeUser({ role: "external" }));
    guest = await signIn(t, await f.makeUser({ role: "external", isGuest: true }));
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
    conditionId = (await f.makeCondition({ jobId, number: 1 })).id;
  });
  afterAll(async () => {
    await t.close();
  });

  const post = (who: SignedIn, url: string, body: unknown) => apiRequest(t, { method: "POST", url, as: who, body });
  const ifMatch = { "if-match": '"1"' };

  const writes: readonly {
    readonly name: string;
    readonly path: string;
    readonly send: () => ReturnType<typeof apiRequest>;
  }[] = [
    {
      name: "POST note",
      path: "body",
      send: () => post(staff, `/v1/jobs/${jobId}/notes`, { body: "a\u0000b" }),
    },
    {
      name: "POST job",
      path: "address",
      send: () => post(staff, "/v1/jobs", { jobNumber: "NUL-1", address: "a\u0000b", subdivisionType: "Amalgamation" }),
    },
    {
      name: "POST access grant",
      path: "displayName",
      send: () =>
        post(staff, "/v1/access-grants", {
          email: "nul@example.test",
          displayName: "a\u0000b",
          role: "client",
          jobId,
        }),
    },
    {
      name: "POST pasted email",
      path: "text",
      send: () => post(staff, `/v1/jobs/${jobId}/emails`, { text: "Subject\u0000\nbody" }),
    },
    {
      name: "PATCH checkpoint krNote",
      path: "krNote",
      send: () =>
        apiRequest(t, {
          method: "PATCH",
          url: `/v1/jobs/${jobId}/checkpoints/i8_3`,
          as: staff,
          headers: ifMatch,
          body: { krNote: "a\u0000b" },
        }),
    },
    {
      name: "PATCH condition krComment",
      path: "krComment",
      send: () =>
        apiRequest(t, {
          method: "PATCH",
          url: `/v1/jobs/${jobId}/conditions/${conditionId}`,
          as: staff,
          headers: ifMatch,
          body: { krComment: "a\u0000" },
        }),
    },
    {
      name: "PUT decision comment",
      path: "comment",
      send: () =>
        apiRequest(t, {
          method: "PUT",
          url: `/v1/jobs/${jobId}/checkpoints/i3_0p/decision`,
          as: client,
          headers: ifMatch,
          body: { value: "declined", comment: "a\u0000b" },
        }),
    },
    {
      name: "PATCH job address (nested path)",
      path: "address",
      send: () =>
        apiRequest(t, {
          method: "PATCH",
          url: `/v1/jobs/${jobId}`,
          as: staff,
          headers: ifMatch,
          body: { address: "\u0000" },
        }),
    },
  ];

  it.each(writes)("$name with U+0000 is a 400 naming the field", async ({ send, path }) => {
    const res = await send();
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "urn:kr:problem:validation",
      errors: [{ path, message: expect.any(String) }],
    });
  });

  it("names the platform message and the field path for the guard itself", async () => {
    const res = await post(staff, `/v1/jobs/${jobId}/notes`, { body: "a\u0000b" });
    expect(res.json()).toMatchObject({ errors: [{ path: "body", message: NUL_MESSAGE }] });
  });

  it.each([
    ["/v1/jobs?q=%00", "staff", "q"],
    ["/v1/jobs?q=ab%00", "guest", "q"],
    ["/v1/users?q=%00", "admin", "q"],
    ["/v1/audit-events?action=%00", "admin", "action"],
  ] as const)("GET %s with U+0000 in the query is a 400 naming the parameter", async (url, who, field) => {
    const res = await apiRequest(t, { url, as: { staff, guest, admin }[who] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      type: "urn:kr:problem:validation",
      errors: [{ path: field, message: NUL_MESSAGE }],
    });
  });

  it("finds NUL in nested array elements and object keys", async () => {
    const res = await post(staff, "/v1/jobs", { jobNumber: "NUL-2", extra: [{ k: "x\u0000" }], address: "ok" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ path: "extra.0.k", message: NUL_MESSAGE }] });
    const key = await post(staff, "/v1/jobs", { "a\u0000b": 1 });
    expect(key.statusCode).toBe(400);
  });

  it.each([5_000, 45_000])("answers a body of %i nested arrays with a 400, not a 500", async (depth) => {
    const nested = "[".repeat(depth) + "]".repeat(depth);
    expect(nested.length).toBeLessThan(100_000);
    const res = await apiRequest(t, {
      method: "POST",
      url: `/v1/jobs/${jobId}/notes`,
      as: staff,
      headers: { "content-type": "application/json" },
      body: nested,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("stores nothing for refused input", async () => {
    const before = await t.db.selectFrom("job_notes").select("id").where("job_id", "=", jobId).execute();
    await post(staff, `/v1/jobs/${jobId}/notes`, { body: "a\u0000b" });
    const after = await t.db.selectFrom("job_notes").select("id").where("job_id", "=", jobId).execute();
    expect(after).toHaveLength(before.length);
  });

  it("still lets unauthenticated callers hit the 401 first", async () => {
    const res = await apiRequest(t, { method: "POST", url: `/v1/jobs/${jobId}/notes`, body: { body: "a\u0000b" } });
    expect(res.statusCode).toBe(401);
  });

  it("leaves ordinary text, including other control characters and emoji, alone", async () => {
    const res = await post(staff, `/v1/jobs/${jobId}/notes`, { body: "Line one\nLine\ttwo \u{1F600}" });
    expect(res.statusCode).toBe(201);
  });
});
