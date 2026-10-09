import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../test/helpers/index.js";
import { IDEMPOTENCY_TTL_MS, sendIdempotent, withIdempotency } from "./idempotency.js";
import type { ApiModule } from "./module.js";

let executions = 0;
let failNext = false;
const mod: ApiModule = {
  name: "idempotency-test",
  operations: [],
  register(app, deps) {
    app.post("/test/idempotent", async (request, reply) => {
      const auth = request.auth;
      if (!auth) throw new Error("unauthenticated");
      const result = await withIdempotency(
        deps.db,
        { request, userId: auth.user.id, operationId: "test.idempotent", body: request.body, clock: deps.clock },
        async (trx) => {
          executions += 1;
          const n = executions;
          await trx.selectFrom("users").select("id").limit(1).execute();
          if (failNext) throw new Error("boom");
          return { status: 201, body: { n } };
        },
      );
      return sendIdempotent(reply, result);
    });
  },
};

describe("idempotency keys (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let me: SignedIn;
  beforeAll(async () => {
    t = await createTestApp({ extraModules: [mod] });
    f = createFactories(t.db);
    me = await signIn(t, await f.makeUser());
  });
  afterAll(async () => {
    await t.close();
  });
  const post = (key: string | undefined, body: unknown, as: SignedIn = me) =>
    apiRequest(t, {
      method: "POST",
      url: "/test/idempotent",
      as,
      body,
      ...(key ? { headers: { "idempotency-key": key } } : {}),
    });
  const key = () => `key-${f.faker.string.alphanumeric(16)}`;

  it("replays the stored response for the same key and request, running the work once", async () => {
    const k = key();
    const before = executions;
    const first = await post(k, { a: 1, b: 2 });
    const second = await post(k, { b: 2, a: 1 });
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(second.json()).toEqual(first.json());
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(executions).toBe(before + 1);
  });

  it("answers 409 when the key is reused with a different body", async () => {
    const k = key();
    await post(k, { a: 1 });
    const res = await post(k, { a: 2 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:conflict" });
  });

  it("scopes keys per user and runs every request when there is no key", async () => {
    const k = key();
    const other = await signIn(t, await f.makeUser());
    const [a, b] = [await post(k, { a: 1 }), await post(k, { a: 1 }, other)];
    expect(a.json()).not.toEqual(b.json());
    const before = executions;
    await post(undefined, { a: 1 });
    await post(undefined, { a: 1 });
    expect(executions).toBe(before + 2);
  });

  it("rejects a malformed key with 400", async () => {
    for (const bad of ["short", "x".repeat(129), "has space in it"]) {
      expect((await post(bad, {})).statusCode, bad).toBe(400);
    }
  });

  it("stores nothing when the work fails, so the retry runs it", async () => {
    const k = key();
    failNext = true;
    expect((await post(k, { a: 1 })).statusCode).toBe(500);
    failNext = false;
    const retry = await post(k, { a: 1 });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("forgets keys after 24 hours", async () => {
    const k = key();
    const first = await post(k, { a: 1 });
    t.clock.advance(IDEMPOTENCY_TTL_MS + 1000);
    const again = await post(k, { a: 1 }, await signIn(t, me.user));
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBeUndefined();
    expect(again.json()).not.toEqual(first.json());
  });

  it("runs the work once for two concurrent identical requests", async () => {
    const k = key();
    const before = executions;
    const fresh = await signIn(t, me.user);
    const [a, b] = await Promise.all([post(k, { a: 1 }, fresh), post(k, { a: 1 }, fresh)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json()).toEqual(b.json());
    expect(executions).toBe(before + 1);
  });
});
