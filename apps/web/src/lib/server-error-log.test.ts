import { describe, expect, it } from "vitest";
import { logServerError, serverErrorEntry } from "./server-error-log";

const NOW = new Date("2026-10-12T02:48:10.000Z");
const REQUEST_ID = "7d5e2b8c-0f3a-4c52-9a6e-1b4d8c2f6a90";
const request = {
  path: "/jobs/00000000-0000-4000-8000-0000000000a1?stage=survey&token=secret",
  method: "GET",
  headers: { "x-request-id": REQUEST_ID, cookie: "__Host-kr_session=secret" },
};
const context = {
  routerKind: "App Router",
  routePath: "/jobs/[jobId]",
  routeType: "render",
  renderSource: "react-server-components",
};

describe("serverErrorEntry", () => {
  it("has the request id of the request, the digest of the error and where it failed", () => {
    const error = Object.assign(new Error("The API could not be reached."), { digest: "4101894172" });
    expect(serverErrorEntry(error, request, context, NOW)).toMatchObject({
      level: "error",
      time: "2026-10-12T02:48:10.000Z",
      msg: "server render error",
      requestId: REQUEST_ID,
      digest: "4101894172",
      method: "GET",
      path: "/jobs/00000000-0000-4000-8000-0000000000a1",
      routePath: "/jobs/[jobId]",
      routeType: "render",
      routerKind: "App Router",
      renderSource: "react-server-components",
      errorName: "Error",
      errorMessage: "The API could not be reached.",
    });
  });

  it("leaves out the query string, cookies and other headers", () => {
    const text = JSON.stringify(serverErrorEntry(new Error("x"), request, context, NOW));
    expect(text).not.toContain("secret");
    expect(text).not.toContain("cookie");
  });

  it("has null for a missing or unsafe request id and for an error without a digest, and copes with a thrown string", () => {
    const entry = serverErrorEntry("boom", { ...request, headers: { "x-request-id": "bad id\nline" } }, context, NOW);
    expect(entry).toMatchObject({ requestId: null, digest: null, errorName: "string", errorMessage: "boom" });
    expect(entry).not.toHaveProperty("stack");
  });

  it("clips a very long message", () => {
    const entry = serverErrorEntry(new Error("x".repeat(5000)), request, context, NOW);
    expect(String(entry.errorMessage).length).toBeLessThanOrEqual(2001);
  });
});

describe("logServerError", () => {
  it("writes exactly one line of JSON", () => {
    const lines: string[] = [];
    logServerError(new Error("multi\nline\nmessage"), request, context, (line) => lines.push(line), NOW);
    expect(lines).toHaveLength(1);
    const [line = ""] = lines;
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ requestId: REQUEST_ID, errorMessage: "multi\nline\nmessage" });
  });
});
