"use client";
import type { FileMeta } from "@kr/contracts";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { contentUrl } from "./content";
import { VIEWER_MESSAGES } from "./messages";
import { usePdfRenderer } from "./pdf-context";
import type { PdfDocumentHandle } from "./pdf-renderer";
import { PdfPage } from "./PdfPage";
import styles from "./PdfView.module.css";

export interface PdfViewProps {
  readonly file: FileMeta;
}

type Loaded = { readonly status: "ready"; readonly document: PdfDocumentHandle } | { readonly status: "error" };

/** The in-app PDF reader (§11.1, replaces the prototype's `<iframe>`): every page in a scrollable column, drawn as it nears view. */
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
      () => {
        if (!cancelled) setLoaded({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [renderer, file.id]);

  return (
    <div ref={scroller} className={styles.scroller}>
      {loaded === null && <Spinner label={VIEWER_MESSAGES.loading} />}
      {loaded?.status === "error" && <p className={styles.failed}>{VIEWER_MESSAGES.pdfFailed}</p>}
      {loaded?.status === "ready" &&
        Array.from({ length: loaded.document.pageCount }, (_, index) => (
          <PdfPage key={index} document={loaded.document} pageNumber={index + 1} scroller={scroller} />
        ))}
    </div>
  );
}
