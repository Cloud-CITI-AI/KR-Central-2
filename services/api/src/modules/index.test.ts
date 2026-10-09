import { ROUTES } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { MODULES } from "./index.js";

describe("module operation ownership", () => {
  it("assigns every non-health registry operation to exactly one module", () => {
    const owned = MODULES.flatMap((m) => m.operations);
    expect(new Set(owned).size).toBe(owned.length);
    const expected = ROUTES.filter((r) => r.tag !== "health").map((r) => r.operationId);
    expect([...owned].sort()).toEqual([...expected].sort());
  });
});
