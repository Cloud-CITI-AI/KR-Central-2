import { jobCapabilitiesFor } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { canUploadToSlot } from "./capabilities";

describe("canUploadToSlot", () => {
  const staffSlot = { uploaders: "staff" } as const;
  const clientSlot = { uploaders: "staff_and_client" } as const;

  it.each([
    ["staff", jobCapabilitiesFor("staff", null), true, true],
    ["kr_admin", jobCapabilitiesFor("kr_admin", null), true, true],
    ["a client", jobCapabilitiesFor("external", "client"), false, true],
    ["an architect", jobCapabilitiesFor("external", "architect"), false, false],
    ["nobody", [], false, false],
  ] as const)("%s: staff slots %s, client slots %s", (_who, capabilities, staff, client) => {
    expect(canUploadToSlot(capabilities, staffSlot)).toBe(staff);
    expect(canUploadToSlot(capabilities, clientSlot)).toBe(client);
  });
});
