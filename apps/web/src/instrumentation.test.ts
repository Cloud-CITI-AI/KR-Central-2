// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const request = { path: "/", method: "GET", headers: { "x-request-id": "7d5e2b8c-0f3a-4c52-9a6e-1b4d8c2f6a90" } };
const context = {
  routerKind: "App Router",
  routePath: "/",
  routeType: "render",
  renderSource: "server-rendering",
  revalidateReason: undefined,
  renderType: "dynamic",
} as const;

describe("onRequestError", () => {
  it("logs a server render error as JSON on stderr with the request id and digest", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await onRequestError(Object.assign(new Error("boom"), { digest: "4101894172" }), request, context);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      msg: "server render error",
      requestId: "7d5e2b8c-0f3a-4c52-9a6e-1b4d8c2f6a90",
      digest: "4101894172",
    });
  });

  it("does nothing outside the Node.js runtime (the edge has no stderr)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await onRequestError(new Error("boom"), request, context);
    expect(write).not.toHaveBeenCalled();
  });
});
