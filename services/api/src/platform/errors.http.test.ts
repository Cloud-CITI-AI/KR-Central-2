import { describe, expect, it } from "vitest";
import { createTestApp, dummyDb } from "../../test/helpers/index.js";
import { markAuthzChecked } from "./auth-context.js";
import { ForbiddenError } from "./errors.js";
import type { ApiModule } from "./module.js";
import { defineRoute } from "./routes.js";

const mod: ApiModule = {
  name: "errors-test",
  operations: [],
  register(app) {
    app.addHook("onRequest", (req, _reply, done) => {
      req.auth = {
        user: {
          id: "0f8fad5b-d9cb-469f-a165-70867728950e",
          displayName: "T",
          email: null,
          role: "staff",
          isGuest: false,
        },
        session: {
          idHash: Buffer.alloc(32),
          csrfToken: "x".repeat(43),
          authTime: new Date(0),
          amr: [],
          acrs: [],
          idleExpiresAt: new Date(0),
          absoluteExpiresAt: new Date(0),
        },
        globalCapabilities: [],
        authzChecked: false,
      };
      done();
    });
    defineRoute(app, "listUsers", ({ auth, query }) => {
      markAuthzChecked(auth);
      if (query.q === "boom") throw new Error("connection to 10.0.0.5 refused (password=hunter2)");
      throw new ForbiddenError({ detail: "Not for you." });
    });
  },
};

describe("error responses over HTTP", () => {
  it("zod errors are 400 with field paths and the request id", async () => {
    const t = await createTestApp({ db: dummyDb(), extraModules: [mod] });
    const res = await t.app.inject({ url: "/v1/users?limit=1000&role=nobody" });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ requestId: string; errors: { path: string }[] }>();
    expect(body.errors.map((e) => e.path).sort()).toEqual(["limit", "role"]);
    expect(body.requestId).toBe(res.headers["x-request-id"]);
    await t.close();
  });

  it("unknown errors are a generic 500 with the request id, no message and no stack; the cause is logged", async () => {
    const t = await createTestApp({ db: dummyDb(), extraModules: [mod] });
    const res = await t.app.inject({ url: "/v1/users?q=boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ type: "about:blank", title: "Internal server error", status: 500 });
    expect(res.body).not.toMatch(/hunter2|10\.0\.0\.5|stack|at \//);
    expect(t.logLines().some((l) => l.event === "request_failed" && l.status === 500)).toBe(true);
    await t.close();
  });

  it("typed errors keep their status and detail", async () => {
    const t = await createTestApp({ db: dummyDb(), extraModules: [mod] });
    const res = await t.app.inject({ url: "/v1/users" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:forbidden", detail: "Not for you." });
    await t.close();
  });
});
