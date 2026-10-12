import { PROBLEM_TYPES } from "@kr/contracts";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { server } from "@/test/msw/server";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { api, buildQuery, signInHref } from "./client";
import { draftKey, registerDraft, takeDraft } from "./drafts";
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

  it("refuses to send a call that lacks a header its route requires, naming the operation, without a request", async () => {
    let requests = 0;
    server.use(
      handlerFor("startConformanceReading", () => {
        requests += 1;
        return HttpResponse.json(operation, { status: 202 });
      }),
      handlerFor("updateCheckpoint", () => {
        requests += 1;
        return HttpResponse.json({});
      }),
    );
    await expect(
      api("startConformanceReading", { params: { jobId: JOB_ID }, body: { fileId: JOB_ID } }),
    ).rejects.toThrow(new RangeError("startConformanceReading needs idempotencyKey"));
    await expect(
      api("updateCheckpoint", { params: { jobId: JOB_ID, checkpointKey: "i4_0" }, body: { status: "completed" } }),
    ).rejects.toThrow(new RangeError("updateCheckpoint needs ifMatch"));
    expect(requests).toBe(0);
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

  it("comes back to the card of a deep link: the page's #fragment goes into returnTo when a 401 sends it to sign-in", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.history.replaceState(null, "", `/jobs/${JOB_ID}?stage=wapc#checkpoint-i13_2`);
    try {
      server.use(mockProblem("getMe", 401, PROBLEM_TYPES.unauthenticated));
      await expect(api("getMe")).rejects.toMatchObject({ status: 401 });
      expect(assign).toHaveBeenCalledWith(
        `/sign-in?returnTo=${encodeURIComponent(`/jobs/${JOB_ID}?stage=wapc#checkpoint-i13_2`)}`,
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("keeps the text of a field with unsaved typing when a 401 sends the person to sign-in, before it navigates", async () => {
    window.sessionStorage.clear();
    const key = draftKey("user-1", JOB_ID, "i8_3", "krNote");
    const stop = registerDraft(key, () => ({
      text: "Synthetic partial comment plus more",
      base: "Synthetic partial comment",
    }));
    const idle = registerDraft(draftKey("user-1", JOB_ID, "note"), () => null);
    const navigated: { kept: string | null } = { kept: null };
    vi.spyOn(navigation, "assign").mockImplementation(() => {
      navigated.kept = window.sessionStorage.getItem(key);
    });
    server.use(mockProblem("getMe", 401, PROBLEM_TYPES.unauthenticated));
    await expect(api("getMe")).rejects.toMatchObject({ status: 401 });
    expect(JSON.parse(navigated.kept ?? "null")).toMatchObject({
      text: "Synthetic partial comment plus more",
      base: "Synthetic partial comment",
    });
    expect(takeDraft(key)?.text).toBe("Synthetic partial comment plus more");
    expect(window.sessionStorage.length).toBe(0);
    stop();
    idle();
  });

  it("still goes to sign-in when the drafts cannot be stored", async () => {
    const stop = registerDraft(draftKey("user-1", "x"), () => ({ text: "typed", base: "" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockProblem("getMe", 401, PROBLEM_TYPES.unauthenticated));
    await expect(api("getMe")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith("/sign-in");
    stop();
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

  it("keeps the #fragment of a deep link inside returnTo, so sign-in lands on the same card (§4)", () => {
    expect(signInHref("/jobs/1", "", "#checkpoint-i13_2")).toBe("/sign-in?returnTo=%2Fjobs%2F1%23checkpoint-i13_2");
    expect(signInHref("/jobs/1", "?stage=wapc", "#checkpoint-i13_2")).toBe(
      "/sign-in?returnTo=%2Fjobs%2F1%3Fstage%3Dwapc%23checkpoint-i13_2",
    );
  });

  it("drops a fragment that would make returnTo too long rather than the whole returnTo, and never loops", () => {
    const long = `#${"a".repeat(600)}`;
    expect(signInHref("/jobs/1", "", long)).toBe("/sign-in?returnTo=%2Fjobs%2F1");
    expect(signInHref("/sign-in", "", "#x")).toBe("/sign-in");
    expect(signInHref("/", "", "#x")).toBe("/sign-in");
  });
});
