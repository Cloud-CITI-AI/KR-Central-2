import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { setCsrfToken } from "./csrf";
import { uploadFile } from "./upload";

const JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RESULT = {
  file: {
    id: JOB_ID,
    jobId: JOB_ID,
    checkpointKey: "i5_0",
    conditionId: null,
    slot: "decision",
    name: "Decision Letter.pdf",
    kind: "pdf",
    contentType: "application/pdf",
    sizeBytes: 3,
    scanStatus: "pending",
    scanRetriesExhausted: false,
    uploadedAt: "2026-09-28T03:50:56.543Z",
    uploadedBy: null,
    canDelete: true,
    email: null,
  },
  operation: null,
};

/** Minimal XMLHttpRequest double: records what was sent and lets a test drive progress and completion. */
class FakeXHR {
  static last: FakeXHR;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: FormData | undefined;
  aborted = false;
  status = 0;
  responseText = "";
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return name === "x-request-id" ? "req-up-1" : null;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  finish(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  setCsrfToken("csrf-token-0123456789");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(undefined);
});

const file = () => new File(["abc"], "Decision Letter.pdf", { type: "application/pdf" });

describe("uploadFile", () => {
  it("posts multipart to the BFF with CSRF and an idempotency key, text fields before the file", async () => {
    const promise = uploadFile({ jobId: JOB_ID, file: file(), checkpointKey: "i5_0", slot: "decision" });
    const xhr = FakeXHR.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`/api/v1/jobs/${JOB_ID}/files`);
    expect(xhr.headers["x-csrf-token"]).toBe("csrf-token-0123456789");
    expect(xhr.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect([...(xhr.body?.keys() ?? [])]).toEqual(["checkpointKey", "slot", "file"]);
    xhr.finish(201, RESULT);
    await expect(promise).resolves.toMatchObject({ file: { name: "Decision Letter.pdf", scanStatus: "pending" } });
  });

  it("uses the caller's idempotency key and sends conditionId uploads without checkpoint fields", () => {
    void uploadFile({ jobId: JOB_ID, file: file(), conditionId: JOB_ID, idempotencyKey: "idem-12345678" });
    expect(FakeXHR.last.headers["idempotency-key"]).toBe("idem-12345678");
    expect([...(FakeXHR.last.body?.keys() ?? [])]).toEqual(["conditionId", "file"]);
  });

  it("reports progress as a fraction and ignores unknown totals", () => {
    const onProgress = vi.fn();
    void uploadFile({ jobId: JOB_ID, file: file(), onProgress });
    FakeXHR.last.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    FakeXHR.last.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    expect(onProgress.mock.calls).toEqual([[0.25]]);
  });

  it("rejects with the ApiProblem (request id kept) for problem+json errors", async () => {
    const promise = uploadFile({ jobId: JOB_ID, file: file() });
    FakeXHR.last.finish(413, {
      type: "urn:kr:problem:payload-too-large",
      title: "Too large",
      status: 413,
      requestId: "req-up-1",
    });
    await expect(promise).rejects.toMatchObject({ status: 413, requestId: "req-up-1", name: "ApiProblem" });
  });

  it("redirects to sign-in on 401, reports a network failure as status 0 and a bad body as an error", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    const unauthorised = uploadFile({ jobId: JOB_ID, file: file() });
    FakeXHR.last.finish(401, { type: "urn:kr:problem:unauthenticated", title: "x", status: 401, requestId: "r" });
    await expect(unauthorised).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith("/sign-in");

    const offline = uploadFile({ jobId: JOB_ID, file: file() });
    FakeXHR.last.onerror?.();
    await expect(offline).rejects.toMatchObject({ status: 0 });

    const broken = uploadFile({ jobId: JOB_ID, file: file() });
    FakeXHR.last.finish(201, { nope: true });
    await expect(broken).rejects.toThrow();
  });

  it("aborts the request when the signal fires, and never starts when already aborted", async () => {
    const controller = new AbortController();
    const promise = uploadFile({ jobId: JOB_ID, file: file(), signal: controller.signal });
    controller.abort();
    expect(FakeXHR.last.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });

    const before = FakeXHR.last;
    await expect(uploadFile({ jobId: JOB_ID, file: file(), signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(FakeXHR.last).toBe(before);
  });
});
