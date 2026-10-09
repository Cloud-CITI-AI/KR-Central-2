import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFJS_WORKER_SRC, pdfjsDocumentOptions, pdfjsRenderer, renderScale } from "./pdf-renderer";

const pdfjs = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist", () => pdfjs);

class Cancelled extends Error {
  override name = "RenderingCancelledException";
}

function fakeLoading() {
  const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(() => renderTask),
  };
  const loading = {
    promise: Promise.resolve({ numPages: 3, getPage: vi.fn(() => Promise.resolve(page)) }),
    destroy: vi.fn(() => Promise.resolve()),
  };
  return { loading, page, renderTask };
}

describe("pdfjsDocumentOptions", () => {
  it("never allows eval or XFA and reads every runtime file from the same origin", () => {
    expect(pdfjsDocumentOptions("/api/v1/files/f1/content")).toEqual({
      url: "/api/v1/files/f1/content",
      isEvalSupported: false,
      enableXfa: false,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      iccUrl: "/pdfjs/iccs/",
      wasmUrl: "/pdfjs/wasm/",
    });
    expect(PDFJS_WORKER_SRC).toBe("/pdfjs/pdf.worker.min.mjs");
  });
});

describe("renderScale", () => {
  it("fits the page to the width and multiplies by the pixel ratio", () => {
    expect(renderScale(600, 800, 900, 1)).toBe(1.5);
    expect(renderScale(600, 800, 900, 2)).toBe(3);
  });

  it("caps the pixel ratio at 2 and never goes below 1", () => {
    expect(renderScale(500, 500, 500, 5)).toBe(2);
    expect(renderScale(500, 500, 500, 0.5)).toBe(1);
  });

  it("keeps the canvas under the 16 million pixel limit of iOS Safari", () => {
    expect(renderScale(1000, 1000, 4000, 2)).toBe(4);
  });
});

describe("pdfjsRenderer", () => {
  beforeEach(() => {
    pdfjs.getDocument.mockReset();
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  });

  it("points pdf.js at the same-origin worker and opens the URL with the safe options", async () => {
    pdfjs.getDocument.mockReturnValue(fakeLoading().loading);
    const document = await pdfjsRenderer.open("/api/v1/files/f1/content");
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe("/pdfjs/pdf.worker.min.mjs");
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/v1/files/f1/content", isEvalSupported: false, enableXfa: false }),
    );
    expect(document.pageCount).toBe(3);
  });

  it("reports the page size and draws a page at the requested width, sharp for the screen", async () => {
    const { loading, page } = fakeLoading();
    pdfjs.getDocument.mockReturnValue(loading);
    const handle = await (await pdfjsRenderer.open("/x")).page(2);
    expect([handle.width, handle.height]).toEqual([600, 800]);
    const canvas = window.document.createElement("canvas");
    await handle.render(canvas, 900).done;
    expect([canvas.width, canvas.height]).toEqual([1800, 2400]);
    expect(page.render).toHaveBeenCalledWith({ canvas, viewport: { width: 1800, height: 2400 } });
  });

  it("treats a cancelled render as finished but passes any other failure on", async () => {
    const { loading, page, renderTask } = fakeLoading();
    pdfjs.getDocument.mockReturnValue(loading);
    const handle = await (await pdfjsRenderer.open("/x")).page(1);
    const canvas = window.document.createElement("canvas");

    page.render.mockReturnValueOnce({ ...renderTask, promise: Promise.reject(new Cancelled()) });
    const cancelled = handle.render(canvas, 900);
    cancelled.cancel();
    await expect(cancelled.done).resolves.toBeUndefined();
    expect(renderTask.cancel).toHaveBeenCalledTimes(1);

    page.render.mockReturnValueOnce({ ...renderTask, promise: Promise.reject(new Error("bad page")) });
    await expect(handle.render(canvas, 900).done).rejects.toThrow("bad page");
  });

  it("destroys the loading task with the document", async () => {
    const { loading } = fakeLoading();
    pdfjs.getDocument.mockReturnValue(loading);
    await (await pdfjsRenderer.open("/x")).destroy();
    expect(loading.destroy).toHaveBeenCalledTimes(1);
  });
});
