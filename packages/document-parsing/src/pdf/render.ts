/**
 * Page 1 as a PNG for the AI stamp reader (PRODUCT_SPEC §10.1 step 3: scale 3, never wider than `maxWidth`). The image
 * is also never taller than `maxHeight`: a page taller than that is cut off at the bottom (the stamp is at the top), so
 * a tiny hostile PDF with a huge page cannot make the worker allocate a huge canvas.
 */
import { createCanvas } from "@napi-rs/canvas";
import { DocumentParseError } from "../errors.js";
import type { PdfLimits } from "../types.js";
import { withPdf } from "./open.js";

export interface RenderOptions {
  /** Widest image in pixels (default 1600). */
  readonly maxWidth?: number;
  /** Tallest image in pixels (default 2400, about an A4 page at the default width); the rest of the page is cut off. */
  readonly maxHeight?: number;
  /** Preferred render scale (default 3); reduced so the image fits `maxWidth` (the height is cut off at `maxHeight`). */
  readonly scale?: number;
  readonly limits?: Partial<PdfLimits>;
}

export function renderFirstPagePng(data: Uint8Array, options: RenderOptions = {}): Promise<Uint8Array> {
  const { maxWidth = 1600, maxHeight = 2400, scale = 3, limits = {} } = options;
  return withPdf(data, limits, async (pdf) => {
    if (pdf.numPages === 0) throw new DocumentParseError("render_failed", "The PDF has no pages to render.");
    const page = await pdf.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(scale, maxWidth / unit.width) });
    try {
      const canvas = createCanvas(
        Math.max(1, Math.min(maxWidth, Math.floor(viewport.width))),
        Math.max(1, Math.min(maxHeight, Math.floor(viewport.height))),
      );
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      return new Uint8Array(canvas.toBuffer("image/png"));
    } catch (error) {
      throw new DocumentParseError("render_failed", "Page 1 could not be rendered.", { cause: error });
    }
  });
}
