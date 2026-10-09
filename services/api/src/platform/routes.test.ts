import { createLogger } from "@kr/logger";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it } from "vitest";
import { markAuthzChecked, type AuthContext } from "./auth-context.js";
import { registerErrorHandling } from "./errors.js";
import { sendIdempotent } from "./idempotency.js";
import { defineRoute } from "./routes.js";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";

function fakeAuth(): AuthContext {
  return {
    user: { id: JOB, displayName: "Test User", email: null, role: "staff", isGuest: false },
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
}

interface Harness {
  readonly app: FastifyInstance;
  logLines(): Record<string, unknown>[];
  close(): Promise<void>;
}

/** A bare Fastify with the platform's compilers and error handler; requests are authenticated as a fake user when `signedIn`. */
async function appWith(register: (app: FastifyInstance) => void, signedIn = true): Promise<Harness> {
  const lines: string[] = [];
  const log: FastifyBaseLogger = createLogger({
    service: "api-test",
    env: "test",
    destination: { write: (m: string) => void lines.push(m) },
  });
  const app = Fastify({ loggerInstance: log });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("auth", null);
  registerErrorHandling(app);
  if (signedIn) {
    app.addHook("onRequest", (req, _reply, done) => {
      req.auth = fakeAuth();
      done();
    });
  }
  register(app);
  await app.ready();
  return { app, logLines: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>), close: () => app.close() };
}

describe("defineRoute", () => {
  it("takes method, path and success status from the contract and serialises through the response schema", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "logout", ({ auth }) => {
        markAuthzChecked(auth);
        return Promise.resolve({ redirectTo: "https://login.example.test/logout" });
      });
    });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectTo: "https://login.example.test/logout" });
    expect((await t.app.inject({ method: "GET", url: "/v1/auth/logout" })).statusCode).toBe(404);
    await t.close();
  });

  it("defaults to the contract's redirect status on routes that only redirect (302)", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "startLogin", async ({ reply }) => reply.header("location", "/idp").send());
    }, false);
    const res = await t.app.inject({ url: "/v1/auth/login" });
    expect([res.statusCode, res.headers.location]).toEqual([302, "/idp"]);
    await t.close();
  });

  it("answers 500 without internals when a handler breaks its response contract", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "logout", ({ auth }) => {
        markAuthzChecked(auth);
        return Promise.resolve({ redirectTo: "not-a-url", leaked: "secret" } as never);
      });
    });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).not.toContain("secret");
    await t.close();
  });

  it("validates params against the contract with field paths and never echoes the input", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "getJob", ({ auth }) => {
        markAuthzChecked(auth);
        return Promise.reject(new Error("unreachable"));
      });
    });
    const res = await t.app.inject({ method: "GET", url: "/v1/jobs/not-a-uuid-<script>" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:validation", errors: [{ path: "jobId" }] });
    expect(JSON.stringify(res.json<{ errors: unknown }>().errors)).not.toContain("script");
    await t.close();
  });

  it("rejects unknown body fields (strict contract) and malformed JSON", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "createNote", ({ auth }) => {
        markAuthzChecked(auth);
        return Promise.reject(new Error("unreachable"));
      });
    });
    const post = (payload: string) =>
      t.app.inject({
        method: "POST",
        url: `/v1/jobs/${JOB}/notes`,
        headers: { "content-type": "application/json" },
        payload,
      });
    const unknown = await post('{"body":"hi","admin":true}');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ errors: unknown[] }>().errors.length).toBeGreaterThan(0);
    const malformed = await post("{nope");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ detail: "The request could not be parsed." });
    await t.close();
  });

  it("requires If-Match on versioned routes (428) and hands the parsed version to the handler", async () => {
    let seen: number | undefined;
    const t = await appWith((app) => {
      defineRoute(app, "updateJob", ({ auth, expectedVersion }) => {
        markAuthzChecked(auth);
        seen = expectedVersion;
        return Promise.reject(new Error("stop"));
      });
    });
    const patch = (headers: Record<string, string>) =>
      t.app.inject({ method: "PATCH", url: `/v1/jobs/${JOB}`, headers, payload: { address: "1 Example St" } });
    expect((await patch({})).statusCode).toBe(428);
    expect((await patch({ "if-match": "7" })).statusCode).toBe(400);
    expect((await patch({ "if-match": '"7"' })).statusCode).toBe(500);
    expect(seen).toBe(7);
    await t.close();
  });

  it("fails closed when a session route finishes without any authorisation check (BE-5)", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "logout", () => Promise.resolve({ redirectTo: "https://x.example.test/" }));
    });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(500);
    expect(t.logLines().some((l) => l.event === "authz_missing" && l.operationId === "logout")).toBe(true);
    await t.close();
  });

  it("blocks the response when the handler sends through the reply without an authorisation check (BE-5)", async () => {
    const t = await appWith((app) => {
      defineRoute(app, "logout", async ({ reply }) =>
        reply.code(200).header("set-cookie", "x=1").send({ redirectTo: "https://leak.example.test/" }),
      );
    });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).not.toContain("leak.example.test");
    expect(res.json()).toMatchObject({ status: 500, title: "Internal server error", instance: "/v1/auth/logout" });
    expect(t.logLines().some((l) => l.event === "authz_missing" && l.operationId === "logout")).toBe(true);
    await t.close();
  });

  it("blocks a sendIdempotent response when no authorisation check ran, and lets it through once one did", async () => {
    const result = { status: 200, body: { redirectTo: "https://leak.example.test/" }, replayed: true };
    const t = await appWith((app) => {
      defineRoute(app, "logout", async ({ reply }) => sendIdempotent(reply, result));
    });
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["idempotent-replayed"]).toBeUndefined();
    expect(res.body).not.toContain("leak.example.test");
    expect(t.logLines().some((l) => l.event === "authz_missing" && l.operationId === "logout")).toBe(true);
    await t.close();

    const ok = await appWith((app) => {
      defineRoute(app, "logout", async ({ reply, auth }) => (markAuthzChecked(auth), sendIdempotent(reply, result)));
    });
    const res2 = await ok.app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect([res2.statusCode, res2.headers["idempotent-replayed"]]).toEqual([200, "true"]);
    expect(res2.json()).toEqual(result.body);
    await ok.close();
  });

  it("answers 401 on a session route when no session was established", async () => {
    const t = await appWith((app) => {
      defineRoute(
        app,
        "logout",
        ({ auth }) => (markAuthzChecked(auth), Promise.resolve({ redirectTo: "https://x.example.test/" })),
      );
    }, false);
    expect((await t.app.inject({ method: "POST", url: "/v1/auth/logout" })).statusCode).toBe(401);
    await t.close();
  });
});
