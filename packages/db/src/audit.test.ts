import { describe, expect, it } from "vitest";
import { diffChanges } from "./audit.js";

describe("diffChanges", () => {
  it("keeps only changed fields", () => {
    expect(diffChanges({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: undefined })).toEqual({
      b: { from: "x", to: "y" },
    });
    expect(diffChanges({ a: 1 }, { a: 1 })).toBeNull();
  });
});
