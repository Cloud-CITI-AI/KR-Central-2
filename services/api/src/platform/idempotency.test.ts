import { describe, expect, it } from "vitest";
import { requestHash, stableStringify } from "./idempotency.js";

describe("stableStringify", () => {
  it("sorts keys at every depth and drops undefined, so equal requests hash equally", () => {
    expect(stableStringify({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
  });
});

describe("requestHash", () => {
  const request = { headers: {}, method: "POST", url: "/v1/jobs" };
  it("is stable under key order and sensitive to operation, method, url and body", () => {
    const base = requestHash({ request, operationId: "createJob", body: { a: 1, b: 2 } });
    expect(requestHash({ request, operationId: "createJob", body: { b: 2, a: 1 } }).equals(base)).toBe(true);
    for (const other of [
      requestHash({ request, operationId: "createNote", body: { a: 1, b: 2 } }),
      requestHash({ request: { ...request, method: "PUT" }, operationId: "createJob", body: { a: 1, b: 2 } }),
      requestHash({ request: { ...request, url: "/v1/jobs?x=1" }, operationId: "createJob", body: { a: 1, b: 2 } }),
      requestHash({ request, operationId: "createJob", body: { a: 1, b: 3 } }),
    ]) {
      expect(other.equals(base)).toBe(false);
    }
  });
});
