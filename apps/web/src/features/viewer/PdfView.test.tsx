import { act, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { PdfDocumentHandle, PdfPageHandle, PdfRenderer, PdfRenderTask } from "./pdf-renderer";
import { PdfRendererContext } from "./pdf-context";
import { installFakeIntersectionObserver, moveTo } from "./test-intersection";
import { renderViewer } from "./test-utils";
import { syntheticFile } from "./test-fixtures";
import { PdfView } from "./PdfView";

interface FakeDocument extends PdfDocumentHandle {
  readonly tasks: Map<number, PdfRenderTask & { cancel: ReturnType<typeof vi.fn> }>;
  /** The `render` calls per page number: a page that was never drawn has none. */
  readonly renders: Map<number, number>;
}

function fakeDocument(pageCount: number, failingPage?: number): FakeDocument {
  const tasks: FakeDocument["tasks"] = new Map();
  const renders: FakeDocument["renders"] = new Map();
  return {
    pageCount,
    tasks,
    renders,
    page: vi.fn((pageNumber: number): Promise<PdfPageHandle> => {
      const task = {
        done: failingPage === pageNumber ? Promise.reject(new Error("bad")) : Promise.resolve(),
        cancel: vi.fn(),
      };
      tasks.set(pageNumber, task);
      const render = vi.fn((canvas: HTMLCanvasElement) => {
        renders.set(pageNumber, (renders.get(pageNumber) ?? 0) + 1);
        canvas.width = 1200; // a drawn page holds pixels
        return task;
      });
      return Promise.resolve({ width: 600, height: 900, render });
    }),
    destroy: vi.fn(() => Promise.resolve()),
  };
}

// pages are drawn after a few promise hops; a busy CI machine needs more than the default 1 s
configure({ asyncUtilTimeout: 5000 });

const file = syntheticFile({ name: "plan.pdf" });
const renderWith = (renderer: PdfRenderer) =>
  renderViewer(
    <PdfRendererContext.Provider value={renderer}>
      <PdfView file={file} />
    </PdfRendererContext.Provider>,
  );

/** The box of each page, in order. */
const pageBoxes = (container: HTMLElement) =>
  [...container.querySelectorAll("canvas")].map((canvas) => canvas.parentElement!);

describe("PdfView", () => {
  beforeEach(installFakeIntersectionObserver);
  afterEach(vi.unstubAllGlobals);

  it("opens the file's content URL and keeps a box with a canvas for every page", async () => {
    const document = fakeDocument(3);
    const renderer = { open: vi.fn(() => Promise.resolve(document)) };
    const { container } = renderWith(renderer);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByText("Page 3 of 3")).toBeInTheDocument();
    expect(renderer.open).toHaveBeenCalledWith(`/api/v1/files/${file.id}/content`);
    expect(container.querySelectorAll("canvas")).toHaveLength(3);
    await expectNoAxeViolations(container);
  });

  it("neither fetches nor draws a page until it comes near the viewport", async () => {
    const document = fakeDocument(5);
    const { container } = renderWith({ open: () => Promise.resolve(document) });
    await screen.findByText("Page 5 of 5");
    const boxes = pageBoxes(container);
    // nothing has been reported as visible yet: no page is fetched or drawn
    expect(document.page).not.toHaveBeenCalled();
    expect(document.renders.size).toBe(0);

    moveTo(boxes[1]!, "near");
    await waitFor(() => {
      expect(document.renders.get(2)).toBe(1);
    });
    expect(document.page).toHaveBeenCalledTimes(1);
    expect(document.page).toHaveBeenCalledWith(2);
    expect([...document.renders.keys()]).toEqual([2]);

    moveTo(boxes[2]!, "near");
    await waitFor(() => {
      expect(document.renders.get(3)).toBe(1);
    });
    expect(document.page).toHaveBeenCalledTimes(2);
    expect(document.renders.has(1) || document.renders.has(4) || document.renders.has(5)).toBe(false);
  });

  it("cancels a page and releases its canvas once it is far away, keeps it between the margins, and draws it again on return", async () => {
    const document = fakeDocument(3);
    const { container } = renderWith({ open: () => Promise.resolve(document) });
    await screen.findByText("Page 3 of 3");
    const [first, second] = pageBoxes(container) as [HTMLElement, HTMLElement];
    const canvas = second.querySelector("canvas")!;

    moveTo(second, "near");
    await waitFor(() => {
      expect(canvas.width).toBe(1200);
    });
    expect(document.tasks.get(2)?.cancel).not.toHaveBeenCalled();

    // just outside the draw margin but inside the release margin: the drawn page stays
    moveTo(second, "between");
    expect(canvas.width).toBe(1200);
    expect(document.tasks.get(2)?.cancel).not.toHaveBeenCalled();

    moveTo(second, "far");
    await waitFor(() => {
      expect(canvas.width).toBe(0);
    });
    expect(canvas.height).toBe(0);
    expect(document.tasks.get(2)?.cancel).toHaveBeenCalledTimes(1);
    // the box keeps the page's shape, so the column does not jump
    expect(second.style.aspectRatio).toBe("1 / 1.5");
    // a page that is far away and was never drawn stays untouched
    expect(first.querySelector("canvas")?.width).not.toBe(1200);
    expect(document.renders.has(1)).toBe(false);

    moveTo(second, "near");
    await waitFor(() => {
      expect(document.renders.get(2)).toBe(2);
    });
    expect(canvas.width).toBe(1200);
  });

  it("stops a page that is still being drawn when it leaves, and ignores its late result", async () => {
    let finish: () => void = () => undefined;
    const document = {
      ...fakeDocument(1),
      page: vi.fn(() =>
        Promise.resolve({
          width: 600,
          height: 900,
          render: () => ({ done: new Promise<void>((resolve) => (finish = resolve)), cancel: vi.fn() }),
        }),
      ),
    };
    const { container } = renderWith({ open: () => Promise.resolve(document) });
    await screen.findByText("Page 1 of 1");
    const [box] = pageBoxes(container) as [HTMLElement];
    moveTo(box, "near");
    await waitFor(() => {
      expect(document.page).toHaveBeenCalledTimes(1);
    });
    moveTo(box, "far");
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws every page when the browser has no IntersectionObserver", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    const document = fakeDocument(3);
    renderWith({ open: () => Promise.resolve(document) });
    await waitFor(() => {
      expect(document.renders.size).toBe(3);
    });
  });

  it("says so when the PDF cannot be opened", async () => {
    renderWith({ open: () => Promise.reject(new Error("corrupt")) });
    expect(await screen.findByText("Couldn’t load this PDF. Use “Open in new tab”.")).toBeInTheDocument();
    expect(screen.queryByText(/Page 1/)).toBeNull();
  });

  it("flags a page that cannot be drawn without losing the others", async () => {
    const { container } = renderWith({ open: () => Promise.resolve(fakeDocument(2, 2)) });
    await screen.findByText("Page 2 of 2");
    for (const box of pageBoxes(container)) moveTo(box, "near");
    expect(await screen.findByRole("alert")).toHaveTextContent("Page 2 couldn’t be drawn.");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("destroys the document when the viewer moves on", async () => {
    const document = fakeDocument(1);
    const { unmount } = renderWith({ open: () => Promise.resolve(document) });
    await screen.findByText("Page 1 of 1");
    unmount();
    expect(document.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a document that finishes opening after the viewer moved on", async () => {
    const document = fakeDocument(1);
    let finish: (value: PdfDocumentHandle) => void = () => undefined;
    const { unmount } = renderWith({ open: () => new Promise((resolve) => (finish = resolve)) });
    unmount();
    await act(async () => {
      finish(document);
      await Promise.resolve();
    });
    expect(document.destroy).toHaveBeenCalledTimes(1);
  });
});
