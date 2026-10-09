/** Response mapping shared by the files routes: a file row, its uploader and email record, as the viewer sees it. */
import type { JobCapability } from "@kr/contracts";
import type { FileRow } from "@kr/db";

export interface FileViewer {
  readonly id: string;
  readonly capabilities: readonly JobCapability[];
}

/** Staff may remove any file; everyone else only their own uploads (PRODUCT_SPEC §2.1). */
export function canDeleteFile(viewer: FileViewer, file: Pick<FileRow, "uploaded_by">): boolean {
  const own = file.uploaded_by !== null && file.uploaded_by === viewer.id;
  return viewer.capabilities.includes("files.delete.any") || (own && viewer.capabilities.includes("files.delete.own"));
}
