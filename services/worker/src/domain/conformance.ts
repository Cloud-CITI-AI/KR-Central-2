/**
 * Reading the conformed date of a Conformance Notification (PRODUCT_SPEC §10.1). Pure: the order of the attempts, the
 * user-facing messages and the result shape live here; the steps themselves (file name, PDF, AI) are handed in.
 */
import type { ConformanceReadResult } from "@kr/contracts";
import type { ConformedMethod } from "@kr/document-parsing";
import { formatDateWithWeekday } from "@kr/workflow";
import type { z } from "zod";

export interface Found {
  readonly date: string;
  readonly method: ConformedMethod;
  /** The stamp as the AI read it ("DATE 16-Mar-2026 FILE 123-26"); null for the other methods. */
  readonly stampText: string | null;
}

/** The attempts, each run only when every earlier one found nothing. A step may be slow (a parse, a model call). */
export interface ReadingSteps {
  fileName(): Found | null;
  stampAnnotation(): Promise<Found | null>;
  /** The AI step: the caller decides whether it is allowed and absorbs its failures (it never blocks). */
  stampImage(): Promise<Found | null>;
  text(): Promise<Found | null>;
}

/** The §10.1 order: file name, stamp annotation, AI stamp reading (only when allowed), then the text rule. */
export async function findConformedDate(steps: ReadingSteps): Promise<Found | null> {
  return steps.fileName() ?? (await steps.stampAnnotation()) ?? (await steps.stampImage()) ?? (await steps.text());
}

/** The stored operation result: the contract's ConformanceReadResult, never a local copy of it. */
export type ConformanceResult = z.output<typeof ConformanceReadResult>;

export function foundResult(found: Found): ConformanceResult {
  const shown = formatDateWithWeekday(found.date);
  const message = {
    file_name: `Taken from the file name: ${shown}.`,
    stamp_annotation: `Read from the stamp on page 1: ${shown}.`,
    stamp_image: `Read from the stamp on page 1${found.stampText ? ` ("${found.stampText}")` : ""}: ${shown}. Please check it below.`,
    text: `No stamp could be read, so the "conformed" date in the text was used: ${shown}. Please check it below.`,
  }[found.method];
  return { found: true, date: found.date, method: found.method, stampText: found.stampText, message };
}

const notFound = (message: string): ConformanceResult => ({
  found: false,
  date: null,
  method: null,
  stampText: null,
  message,
});

export const noStampResult = (fileName: string): ConformanceResult =>
  notFound(`No stamped date could be found on page 1 of ${fileName}. Enter the conformed date below.`);

export const unreadableResult = (fileName: string): ConformanceResult =>
  notFound(`${fileName} couldn't be read. Enter the conformed date below.`);
