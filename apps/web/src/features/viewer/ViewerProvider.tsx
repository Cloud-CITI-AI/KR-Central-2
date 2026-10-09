"use client";
import type { FileMeta } from "@kr/contracts";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PdfRendererContext } from "./pdf-context";
import { pdfjsRenderer, type PdfRenderer } from "./pdf-renderer";
import { ViewerDialog } from "./ViewerDialog";

export interface ViewerApi {
  /** Open the document viewer on `files[index]` with ‹ › navigation across `files`. */
  open(files: readonly FileMeta[], index: number): void;
}

const ViewerContext = createContext<ViewerApi>({ open: () => undefined });

export interface ViewerProviderProps {
  readonly children: ReactNode;
  /** The PDF engine; pdf.js unless a test supplies another adapter. */
  readonly pdfRenderer?: PdfRenderer;
}

interface Opened {
  readonly files: readonly FileMeta[];
  readonly index: number;
}

/** Document viewer dialog provider (§11.1). Mounted once by the authenticated layout `(app)/layout.tsx` (WP-03). */
export function ViewerProvider({ children, pdfRenderer = pdfjsRenderer }: ViewerProviderProps) {
  // `opened` keeps the last files while the dialog is closed, so the Dialog sees open go true -> false and returns focus.
  const [opened, setOpened] = useState<Opened | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback((files: readonly FileMeta[], index: number) => {
    if (files.length === 0) return;
    setOpened({ files, index: Math.min(Math.max(index, 0), files.length - 1) });
    setIsOpen(true);
  }, []);
  const api = useMemo<ViewerApi>(() => ({ open }), [open]);

  return (
    <ViewerContext.Provider value={api}>
      <PdfRendererContext.Provider value={pdfRenderer}>
        {children}
        {opened && (
          <ViewerDialog
            open={isOpen}
            files={opened.files}
            index={opened.index}
            onIndexChange={(index) => {
              setOpened({ files: opened.files, index });
            }}
            onClose={() => {
              setIsOpen(false);
            }}
          />
        )}
      </PdfRendererContext.Provider>
    </ViewerContext.Provider>
  );
}

export function useViewer(): ViewerApi {
  return useContext(ViewerContext);
}
