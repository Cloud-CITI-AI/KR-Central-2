import { describe, expect, it } from "vitest";
import { ObjectNotFoundError, StorageUnavailableError, isStorageUnavailable } from "./errors.js";

const withCode = (code: string, message = code): Error => Object.assign(new Error(message), { code });

describe("isStorageUnavailable", () => {
  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
  ])("treats a %s socket error as an outage", (code) => {
    expect(isStorageUnavailable(withCode(code))).toBe(true);
  });

  it("looks inside AggregateError (dual-stack connects) and causes", () => {
    expect(isStorageUnavailable(new AggregateError([withCode("ECONNREFUSED")], "connect failed"))).toBe(true);
    expect(isStorageUnavailable(new Error("wrapper", { cause: withCode("ETIMEDOUT") }))).toBe(true);
  });

  it("treats SDK timeouts and 5xx or throttling answers as an outage", () => {
    expect(isStorageUnavailable(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isStorageUnavailable(Object.assign(new Error("t"), { name: "RequestTimeout" }))).toBe(true);
    for (const httpStatusCode of [500, 502, 503, 504, 429]) {
      expect(isStorageUnavailable(Object.assign(new Error("x"), { $metadata: { httpStatusCode } }))).toBe(true);
    }
  });

  it("does not treat client-side or content errors as an outage", () => {
    expect(isStorageUnavailable(new ObjectNotFoundError("k"))).toBe(false);
    expect(isStorageUnavailable(new RangeError("Object key must be 1 to 1024 bytes long"))).toBe(false);
    expect(isStorageUnavailable(Object.assign(new Error("x"), { $metadata: { httpStatusCode: 403 } }))).toBe(false);
    expect(isStorageUnavailable(withCode("ERR_STREAM_PREMATURE_CLOSE"))).toBe(false);
    expect(isStorageUnavailable("ECONNREFUSED")).toBe(false);
    expect(isStorageUnavailable(undefined)).toBe(false);
  });

  it("is the error type the API maps to 503", () => {
    const e = new StorageUnavailableError(withCode("ECONNREFUSED"));
    expect(e.name).toBe("StorageUnavailableError");
    expect(e.cause).toBeInstanceOf(Error);
  });
});
