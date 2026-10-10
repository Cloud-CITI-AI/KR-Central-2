import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GLOBAL_ROLES, GRANT_ROLES, hasCapability } from "./capabilities.js";
import * as permissions from "./permissions.js";

describe("capabilities (schema-free entry point)", () => {
  it("is what permissions.ts builds its enums from and re-exports", () => {
    expect(permissions.GLOBAL_ROLES).toBe(GLOBAL_ROLES);
    expect(permissions.GRANT_ROLES).toBe(GRANT_ROLES);
    expect(permissions.hasCapability).toBe(hasCapability);
    expect(permissions.GlobalRole.options).toEqual([...GLOBAL_ROLES]);
    expect(permissions.GrantRole.options).toEqual([...GRANT_ROLES]);
  });

  it("checks a capability", () => {
    expect(hasCapability(["audit.read"], "audit.read")).toBe(true);
    expect(hasCapability(["audit.read"], "users.manage")).toBe(false);
    expect(hasCapability([], "audit.read")).toBe(false);
  });

  it("imports nothing (no Zod, no schemas)", () => {
    const source = readFileSync(fileURLToPath(new URL("./capabilities.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/^\s*(?:import|export)\b[^;]*\bfrom\s+"/m);
  });
});
