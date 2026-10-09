"use client";
import type { FileMeta } from "@kr/contracts";
import { createContext, useContext, type ReactNode } from "react";

export interface ViewerApi {
  /** Open the document viewer on `files[index]` with ‹ › navigation across `files`. */
  open(files: readonly FileMeta[], index: number): void;
}

const ViewerContext = createContext<ViewerApi>({ open: () => undefined });

export interface ViewerProviderProps {
  readonly children: ReactNode;
}

/** Document viewer dialog provider (§11.1) — STUB owned by WP-17. Mounted once by the tracker page (WP-14). */
export function ViewerProvider({ children }: ViewerProviderProps) {
  return <ViewerContext.Provider value={{ open: () => undefined }}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerApi {
  return useContext(ViewerContext);
}
