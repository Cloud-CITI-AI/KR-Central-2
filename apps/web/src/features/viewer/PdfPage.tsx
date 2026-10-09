"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PdfDocumentHandle, PdfRenderTask } from "./pdf-renderer";
import styles from "./PdfView.module.css";
import { useNearViewport } from "./useNearViewport";

export interface PdfPageProps {
  readonly document: PdfDocumentHandle;
  /** 1-based. */
  readonly pageNumber: number;
  /** The scrolling column the page sits in: a page is drawn only while it is near its visible part. */
  readonly scroller: RefObject<HTMLElement | null>;
}

const A4_HEIGHT_OVER_WIDTH = 297 / 210;

/**
 * One page of a PDF (§11.1: all pages, scrollable). The box always holds the page's shape, so the column keeps its length,
 * but the page is fetched and drawn only while it is near the viewport and its canvas is released once it is far away. A
 * canvas of a full-width page is about 20 MB at 2x, so drawing a long PDF at once would exhaust iOS Safari's memory.
 */
export function PdfPage({ document, pageNumber, scroller }: PdfPageProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [heightOverWidth, setHeightOverWidth] = useState(A4_HEIGHT_OVER_WIDTH);
  const [failed, setFailed] = useState(false);
  const near = useNearViewport(box, scroller);

  useEffect(() => {
    const target = canvas.current;
    if (!near || !target) return;
    let cancelled = false;
    let task: PdfRenderTask | undefined;
    document
      .page(pageNumber)
      .then((page) => {
        if (cancelled) return undefined;
        setHeightOverWidth(page.height / page.width);
        const measured = box.current?.clientWidth ?? 0;
        task = page.render(target, measured > 0 ? measured : page.width);
        return task.done;
      })
      .then(
        () => {
          if (!cancelled) setFailed(false);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    return () => {
      cancelled = true;
      task?.cancel();
      target.width = 0; // releases the pixels: the page was scrolled far away, or the viewer closed
      target.height = 0;
    };
  }, [document, pageNumber, near]);

  return (
    <div ref={box} className={styles.page} style={{ aspectRatio: `1 / ${heightOverWidth}` }}>
      <canvas ref={canvas} className={styles.canvas}>
        Page {pageNumber} of {document.pageCount}
      </canvas>
      {failed && (
        <p role="alert" className={styles.pageError}>
          Page {pageNumber} couldn’t be drawn.
        </p>
      )}
    </div>
  );
}
