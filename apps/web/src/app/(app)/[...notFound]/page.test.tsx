import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => navigation);

import UnknownRoute, { metadata } from "./page";

describe("(app) catch-all page", () => {
  it("answers every unmatched URL with notFound(), so the (app) layout frames the 404 for a signed-in person", () => {
    expect(() => UnknownRoute()).toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalledOnce();
  });

  it("is titled for the page, not the app", () => {
    expect(metadata.title).toBe("Page not found");
  });
});
