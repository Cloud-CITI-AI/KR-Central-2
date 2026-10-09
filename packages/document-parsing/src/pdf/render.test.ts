import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { buildBlankPdf, buildEncryptedPdf, buildPdf } from "../../test/fixtures/builders.js";
import { renderFirstPagePng } from "./render.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Number of pixels that are not white. */
async function inkedPixels(png: Uint8Array): Promise<number> {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 200) inked += 1;
  return inked;
}

describe("renderFirstPagePng", () => {
  it("renders page 1 as a PNG no wider than 1600 px, with the page text visible", async () => {
    const png = await renderFirstPagePng(await buildPdf({ pages: [["Conformed 16 March 2026"], ["second"]] }));
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const image = await loadImage(Buffer.from(png));
    expect(image.width).toBeLessThanOrEqual(1600);
    expect(image.width).toBeGreaterThan(1500); // scale 3 of an A4 page is capped to the width, not shrunk further
    expect(image.height / image.width).toBeCloseTo(842 / 595, 1);
    expect(await inkedPixels(png)).toBeGreaterThan(200);
  });

  it("honours a smaller maxWidth and a smaller scale", async () => {
    const bytes = await buildPdf({ pages: [["hello"]] });
    expect(
      (await loadImage(Buffer.from(await renderFirstPagePng(bytes, { maxWidth: 300 })))).width,
    ).toBeLessThanOrEqual(300);
    expect((await loadImage(Buffer.from(await renderFirstPagePng(bytes, { scale: 1 })))).width).toBe(595);
  });

  it.each([
    ["very tall", [540, 100_000]],
    ["very wide", [100_000, 540]],
  ] as const)("keeps the image small for a %s page", async (_name, pageSize) => {
    const png = await renderFirstPagePng(await buildPdf({ pages: [["top of the page"]], pageSize }));
    const image = await loadImage(Buffer.from(png));
    expect(image.width).toBeLessThanOrEqual(1600);
    expect(image.height).toBeLessThanOrEqual(2400);
  });

  it("cuts a tall page off at maxHeight and keeps its top", async () => {
    const bytes = await buildPdf({ pages: [["top of the page"]], pageSize: [540, 100_000] });
    const image = await loadImage(Buffer.from(await renderFirstPagePng(bytes, { maxHeight: 500 })));
    expect(image.height).toBe(500);
    expect(image.width).toBe(1600);
  });

  it("fails with a typed error for a PDF that cannot be rendered", async () => {
    await expect(renderFirstPagePng(await buildEncryptedPdf())).rejects.toMatchObject({ code: "encrypted_pdf" });
    await expect(renderFirstPagePng(await buildBlankPdf(3), { limits: { maxPages: 2 } })).rejects.toMatchObject({
      code: "too_many_pages",
    });
  });
});
