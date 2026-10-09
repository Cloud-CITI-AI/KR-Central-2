import { describe, expect, it } from "vitest";
import { objectKeyFor } from "./index.js";

describe("objectKeyFor", () => {
  it("builds keys from ids only", () => {
    expect(objectKeyFor("j1", "f1")).toBe("jobs/j1/f1");
  });
});
