"use client";
import type { FileMeta } from "@kr/contracts";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { contentUrl } from "./content";
import { VIEWER_MESSAGES, loadFailedText } from "./messages";
import { usePdfRenderer } from "./pdf-context";
import type { PdfDocumentHandle } from "./pdf-renderer";
import { PdfPage } from "./PdfPage";
import styles from "./PdfView.module.css";

export interface PdfViewProps {
  readonly file: FileMeta;
}

/** `tabindex="0"`: the scrolling column joins the tab order, which is how a keyboard user reaches it (WCAG 2.1.1). */
const IN_TAB_ORDER = 0;

type Loaded =
  | { readonly status: "ready"; readonly document: PdfDocumentHandle }
  | { readonly status: "error"; readonly message: string };

/**
 * The in-app PDF reader (§11.1, replaces the prototype's `<iframe>`): every page in a scrollable column, drawn as it nears view.
 * The column is a focusable region named "Pages of <file>", so a keyboard user can tab to it and scroll with the arrow, Page and
 * Home/End keys (WCAG 2.1.1; axe `scrollable-region-focusable`).
 */
export function PdfView({ file }: PdfViewProps) {
  const renderer = usePdfRenderer();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: PdfDocumentHandle | undefined;
    renderer.open(contentUrl(file.id)).then(
      (document) => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        opened = document;
        setLoaded({ status: "ready", document });
      },
      (error: unknown) => {
        if (!cancelled) setLoaded({ status: "error", message: loadFailedText(error, VIEWER_MESSAGES.pdfFailed) });
      },
    );
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [renderer, file.id]);

  return (
    <div
      ref={scroller}
      className={styles.scroller}
      role="region"
      aria-label={`Pages of ${file.name}`}
      tabIndex={IN_TAB_ORDER}
    >
      {loaded === null && <Spinner label={VIEWER_MESSAGES.loading} />}
      {loaded?.status === "error" && <p className={styles.failed}>{loaded.message}</p>}
      {loaded?.status === "ready" &&
        Array.from({ length: loaded.document.pageCount }, (_, index) => (
          <PdfPage key={index} document={loaded.document} pageNumber={index + 1} scroller={scroller} />
        ))}
    </div>
  );
}
