import { PROBLEM_TYPES } from "@kr/contracts";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { server } from "@/test/msw/server";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { api, buildQuery, signInHref } from "./client";
import { ApiProblem } from "./problem";
import { setCsrfToken } from "./csrf";

const JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const operation = {
  id: JOB_ID,
  jobId: JOB_ID,
  type: "file.scan",
  status: "queued",
  createdAt: "2026-09-28T03:50:56.543Z",
  completedAt: null,
  result: null,
  error: null,
};

afterEach(() => {
  setCsrfToken(undefined);
});

describe("api()", () => {
  it("calls the contract route through /api with path params and a parsed response", async () => {
    server.use(mockApi("getOperation", operation));
    await expect(api("getOperation", { params: { operationId: JOB_ID } })).resolves.toMatchObject({ status: "queued" });
  });

  it("sends the CSRF token, If-Match, Idempotency-Key and a JSON body on writes only", async () => {
    setCsrfToken("csrf-token-0123456789");
    const seen: Request[] = [];
    server.use(
      handlerFor("deleteNote", ({ request }) => {
        seen.push(request.clone());
        return new HttpResponse(null, { status: 204 });
      }),
      handlerFor("createNote", ({ request }) => {
        seen.push(request.clone());
        return HttpResponse.json({}, { status: 201 });
      }),
      handlerFor("getOperation", ({ request }) => {
        seen.push(request.clone());
        return HttpResponse.json(operation);
      }),
    );
    await api("getOperation", { params: { operationId: JOB_ID } });
    await expect(api("deleteNote", { params: { jobId: JOB_ID, noteId: JOB_ID }, ifMatch: 3 })).resolves.toBeUndefined();
    await expect(
      api("createNote", {
        params: { jobId: JOB_ID },
        body: { audience: "all", body: "hi" },
        idempotencyKey: "idem-12345678",
      }),
    ).rejects.toThrow(); // the stub body is not a contract note: dev/test parsing catches drift
    const [read, del, create] = seen;
    expect(read?.headers.get("x-csrf-token")).toBeNull();
    expect(del?.method).toBe("DELETE");
    expect(del?.headers.get("x-csrf-token")).toBe("csrf-token-0123456789");
    expect(del?.headers.get("if-match")).toBe('"3"');
    expect(create?.headers.get("idempotency-key")).toBe("idem-12345678");
    expect(create?.headers.get("content-type")).toBe("application/json");
    expect(await create?.json()).toEqual({ audience: "all", body: "hi" });
  });

  it("sends query parameters, skipping undefined ones", async () => {
    let url = "";
    server.use(
      http.get("*/api/v1/jobs", ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await api("listJobs", { query: { limit: 5, cursor: undefined, q: "a b" } });
    expect(new URL(url).search).toBe("?limit=5&q=a+b");
    expect(buildQuery(undefined)).toBe("");
  });

  it("turns problem+json into an ApiProblem with its request id and field errors", async () => {
    server.use(
      mockProblem("getOperation", 400, PROBLEM_TYPES.validation, { errors: [{ path: "text", message: "Required" }] }),
    );
    const error = await api("getOperation", { params: { operationId: JOB_ID } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toMatchObject({
      status: 400,
      type: PROBLEM_TYPES.validation,
      requestId: "req-test-0001",
      errors: [{ path: "text", message: "Required" }],
      isStale: false,
    });
  });

  it("flags a 412 as stale", async () => {
    server.use(mockProblem("deleteNote", 412, PROBLEM_TYPES.preconditionFailed));
    const error = await api("deleteNote", { params: { jobId: JOB_ID, noteId: JOB_ID }, ifMatch: 1 }).catch(
      (e: unknown) => e,
    );
    expect((error as ApiProblem).isStale).toBe(true);
  });

  it("makes a generic problem of a non-problem failure, keeping the request id header", async () => {
    server.use(
      handlerFor(
        "getOperation",
        () => new HttpResponse("<html>bad gateway</html>", { status: 502, headers: { "x-request-id": "req-edge-1" } }),
      ),
    );
    await expect(api("getOperation", { params: { operationId: JOB_ID } })).rejects.toMatchObject({
      status: 502,
      requestId: "req-edge-1",
    });
  });

  it("reports an unreachable server as a status-0 problem and rethrows an abort", async () => {
    server.use(handlerFor("getOperation", () => HttpResponse.error()));
    await expect(api("getOperation", { params: { operationId: JOB_ID } })).rejects.toMatchObject({ status: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      api("getOperation", { params: { operationId: JOB_ID }, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("redirects to sign-in on 401 and still throws", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockProblem("getMe", 401, PROBLEM_TYPES.unauthenticated));
    await expect(api("getMe")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith("/sign-in");
  });

  it("rejects a response that breaks the contract (dev and test only)", async () => {
    server.use(handlerFor("getOperation", () => HttpResponse.json({ nope: true })));
    await expect(api("getOperation", { params: { operationId: JOB_ID } })).rejects.toThrow();
  });
});

describe("signInHref", () => {
  it("returns to the current same-origin path, but never loops on the sign-in pages", () => {
    expect(signInHref("/jobs/1", "?stage=wapc")).toBe("/sign-in?returnTo=%2Fjobs%2F1%3Fstage%3Dwapc");
    expect(signInHref("/")).toBe("/sign-in");
    expect(signInHref("/sign-in-error", "?reason=failed")).toBe("/sign-in");
    expect(signInHref("//evil.example.com")).toBe("/sign-in");
  });
});
