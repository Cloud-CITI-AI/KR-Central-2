import { describe, expect, it, vi } from "vitest";
import { buildPdf } from "../../test/fixtures/builders.js";

vi.mock("@napi-rs/canvas", () => ({
  createCanvas: () => {
    throw new Error("Failed to allocate the surface");
  },
}));

describe("renderFirstPagePng when the canvas cannot be created", () => {
  it("reports render_failed (not unreadable_pdf) and keeps the cause", async () => {
    const { renderFirstPagePng } = await import("./render.js");
    const error: unknown = await renderFirstPagePng(await buildPdf({ pages: [["hello"]] })).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "DocumentParseError", code: "render_failed" });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });
});
