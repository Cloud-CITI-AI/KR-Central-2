"use client";
import { createContext, useContext } from "react";
import { pdfjsRenderer, type PdfRenderer } from "./pdf-renderer";

/** The PDF engine the viewer uses: pdf.js, unless a provider (tests) supplies another adapter. */
export const PdfRendererContext = createContext<PdfRenderer>(pdfjsRenderer);

export function usePdfRenderer(): PdfRenderer {
  return useContext(PdfRendererContext);
}
