/** Synthetic files for checkpoint tests (TD-1: nothing here comes from the prototype's real job). */
import { faker } from "@faker-js/faker";
import { FileMeta, UploadResult } from "@kr/contracts";
import type { z } from "zod";

const UPLOADED = "2026-09-28T03:50:56.543Z";

/** A stored file of `jobId`; override any field (name, kind, slot, scanStatus, email …). */
export function syntheticFile(jobId: string, overrides: Partial<FileMeta> = {}): FileMeta {
  const name = overrides.name ?? "Plan.pdf";
  return FileMeta.parse({
    id: faker.string.uuid(),
    jobId,
    checkpointKey: null,
    conditionId: null,
    slot: null,
    name,
    kind: name.toLowerCase().endsWith(".dwg") ? "dwg" : "pdf",
    contentType: name.toLowerCase().endsWith(".dwg") ? "application/octet-stream" : "application/pdf",
    sizeBytes: 1024,
    scanStatus: "clean",
    uploadedAt: UPLOADED,
    uploadedBy: null,
    canDelete: true,
    email: null,
    ...overrides,
  });
}

/** What `uploadFile` answers for a stored file. */
export function uploadResult(file: FileMeta, operation: z.input<typeof UploadResult>["operation"] = null) {
  return UploadResult.parse({ file, operation });
}
