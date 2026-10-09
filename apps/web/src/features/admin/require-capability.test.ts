import { describe, expect, it, vi } from "vitest";
import { syntheticMe } from "@/test/fixtures";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);

import { requireCapability } from "./require-capability";

describe("requireCapability", () => {
  it("returns the session of a person who has the capability", async () => {
    const me = syntheticMe("kr_admin");
    session.getMe.mockResolvedValue(me);
    await expect(requireCapability("audit.read")).resolves.toBe(me);
  });

  it.each([
    ["kr_admin", "users.manage"],
    ["staff", "audit.read"],
    ["external", "audit.read"],
  ] as const)("is the not-found page for %s without %s", async (role, capability) => {
    session.getMe.mockResolvedValue(syntheticMe(role));
    await expect(requireCapability(capability)).rejects.toMatchObject({
      digest: expect.stringContaining("404") as unknown,
    });
  });
});
