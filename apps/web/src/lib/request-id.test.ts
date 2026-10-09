import { describe, expect, it } from "vitest";
import { ensureRequestId } from "./request-id";

describe("ensureRequestId", () => {
  it("keeps an inert incoming id", () => {
    expect(ensureRequestId("req-1234.abcd_EF")).toBe("req-1234.abcd_EF");
  });

  it.each([null, undefined, "", "short", "has space in it", "line\nbreak-id", "x".repeat(129)])(
    "generates a fresh id instead of %j",
    (value) => {
      expect(ensureRequestId(value)).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
