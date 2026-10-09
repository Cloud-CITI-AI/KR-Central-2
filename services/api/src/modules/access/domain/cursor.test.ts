import { describe, expect, it } from "vitest";
import { decodeGrantCursor, encodeGrantCursor } from "./cursor.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("grant cursor", () => {
  it("round-trips a grant id and rejects malformed input", () => {
    expect(decodeGrantCursor(encodeGrantCursor(ID))).toBe(ID);
    for (const bad of [
      "!!!",
      Buffer.from("{}").toString("base64url"),
      Buffer.from('{"i":"x"}').toString("base64url"),
    ]) {
      expect(decodeGrantCursor(bad)).toBeNull();
    }
  });
});
