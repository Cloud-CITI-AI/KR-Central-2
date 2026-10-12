import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import { installEs2026Polyfills } from "./es2026-polyfills";

/**
 * The viewer's view of a PDF engine. The components only know this adapter, so unit tests replace it with a fake and
 * pdf.js (a large, lazily loaded chunk) is touched only by `pdfjsRenderer` below (real rendering: WP-19 e2e).
 */
export interface PdfRenderTask {
  /** Resolves when the page is drawn, or when it was cancelled. Rejects when drawing failed. */
  readonly done: Promise<void>;
  readonly cancel: () => void;
}

export interface PdfPageHandle {
  /** Page size at 100 %, in CSS pixels: used for the aspect ratio before the page is drawn. */
  readonly width: number;
  readonly height: number;
  /** Draw into `canvas` so that it fills `cssWidth` CSS pixels (the caller sizes the element with CSS). */
  readonly render: (canvas: HTMLCanvasElement, cssWidth: number) => PdfRenderTask;
}

export interface PdfDocumentHandle {
  readonly pageCount: number;
  /** 1-based. */
  readonly page: (pageNumber: number) => Promise<PdfPageHandle>;
  readonly destroy: () => Promise<void>;
}

export interface PdfRenderer {
  readonly open: (url: string) => Promise<PdfDocumentHandle>;
}

/** Where `public/pdfjs` is served: same origin, so CSP `worker-src 'self' blob:` and `connect-src 'self'` suffice. */
export const PDFJS_BASE = "/pdfjs/";
/**
 * Not the shipped `pdf.worker.min.mjs` itself: a small module that installs the ES2026 polyfills in the worker and then imports it
 * (public/pdfjs/pdf.worker.polyfilled.mjs), so browsers without `Map.prototype.getOrInsertComputed`, `Math.sumPrecise` and the like can
 * open and draw PDFs.
 */
export const PDFJS_WORKER_SRC = `${PDFJS_BASE}pdf.worker.polyfilled.mjs`;

/** iOS Safari refuses canvases above 16 777 216 pixels; stay below that and cap the device pixel ratio at 2. */
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_PIXEL_RATIO = 2;

/**
 * `isEvalSupported: false` is required by ADR-0011 / DECISIONS_LOG #2. pdfjs-dist 6.x no longer has an eval path and
 * dropped the option from its typings, so it is inert today; it is passed (and tested) so a library change cannot
 * silently bring `eval` back into a viewer that opens untrusted PDFs.
 */
export type PdfjsDocumentOptions = DocumentInitParameters & { readonly isEvalSupported: false };

/** The pdf.js options that matter for safety and offline assets: no `eval`, no XFA, no scripting, same-origin data. */
export function pdfjsDocumentOptions(url: string): PdfjsDocumentOptions {
  return {
    url,
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
    wasmUrl: `${PDFJS_BASE}wasm/`,
  };
}

/** Scale that draws a page of `width` x `height` (at 100 %) `cssWidth` wide, sharp but within the canvas limit. */
export function renderScale(width: number, height: number, cssWidth: number, pixelRatio: number): number {
  const fit = cssWidth / width;
  const sharp = fit * Math.min(Math.max(pixelRatio, 1), MAX_PIXEL_RATIO);
  const limit = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  return Math.min(sharp, limit);
}

/** pdf.js signals a cancelled render by rejecting with this named exception. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

/** The pdf.js implementation: the library is imported on first use, so it stays out of every other page's bundle. */
export const pdfjsRenderer: PdfRenderer = {
  async open(url) {
    installEs2026Polyfills();
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    const loading = pdfjs.getDocument(pdfjsDocumentOptions(url));
    const document = await loading.promise;
    return {
      pageCount: document.numPages,
      async page(pageNumber) {
        const page = await document.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        return {
          width: base.width,
          height: base.height,
          render(canvas, cssWidth) {
            const viewport = page.getViewport({
              scale: renderScale(base.width, base.height, cssWidth, window.devicePixelRatio),
            });
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const task = page.render({ canvas, viewport });
            return {
              done: task.promise.catch((error: unknown) => {
                if (!isCancellation(error)) throw error;
              }),
              cancel: () => {
                task.cancel();
              },
            };
          },
        };
      },
      destroy: () => loading.destroy(),
    };
  },
};
