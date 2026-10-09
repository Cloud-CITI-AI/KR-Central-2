import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories } from "../../test/factories.js";
import { createTestApp, signIn, type SignedIn, type TestApp } from "../../test/helpers/index.js";
import { markAuthzChecked } from "./auth-context.js";
import { ForbiddenError } from "./errors.js";
import type { ApiModule } from "./module.js";
import { defineRoute } from "./routes.js";

const mod: ApiModule = {
  name: "errors-test",
  operations: [],
  register(app) {
    defineRoute(app, "listUsers", ({ auth, query }) => {
      markAuthzChecked(auth);
      if (query.q === "boom") throw new Error("connection to 10.0.0.5 refused (password=hunter2)");
      throw new ForbiddenError({ detail: "Not for you." });
    });
  },
};

describe("error responses over HTTP (signed in)", () => {
  let t: TestApp;
  let me: SignedIn;
  beforeAll(async () => {
    t = await createTestApp({ modules: [mod] });
    me = await signIn(t, await createFactories(t.db).makeUser());
  });
  afterAll(async () => {
    await t.close();
  });
  const get = (url: string) => t.app.inject({ url, headers: { cookie: me.cookie } });

  it("zod errors are 400 with field paths and the request id", async () => {
    const res = await get("/v1/users?limit=1000&role=nobody");
    expect(res.statusCode).toBe(400);
    const body = res.json<{ requestId: string; errors: { path: string }[] }>();
    expect(body.errors.map((e) => e.path).sort()).toEqual(["limit", "role"]);
    expect(body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("unknown errors are a generic 500 with the request id, no message and no stack; the cause is logged", async () => {
    const res = await get("/v1/users?q=boom");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ type: "about:blank", title: "Internal server error", status: 500 });
    expect(res.body).not.toMatch(/hunter2|10\.0\.0\.5|stack|at \//);
    expect(t.logLines().some((l) => l.event === "request_failed" && l.status === 500)).toBe(true);
  });

  it("typed errors keep their status and detail", async () => {
    const res = await get("/v1/users");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:forbidden", detail: "Not for you." });
  });
});
