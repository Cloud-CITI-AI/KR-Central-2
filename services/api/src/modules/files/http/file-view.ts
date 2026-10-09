/** Response mapping shared by the files routes: a file row, its uploader and email record, as the viewer sees it. */
import type { FileMeta, JobCapability } from "@kr/contracts";
import type { Db, EmailMessageRow, FileRow } from "@kr/db";
import { toFileMeta } from "../../_shared/index.js";
import { findEmail, findUploaderRef } from "../data/files.js";

export interface FileViewer {
  readonly id: string;
  readonly capabilities: readonly JobCapability[];
}

/** Staff may remove any file; everyone else only their own uploads (PRODUCT_SPEC §2.1). */
export function canDeleteFile(viewer: FileViewer, file: Pick<FileRow, "uploaded_by">): boolean {
  const own = file.uploaded_by !== null && file.uploaded_by === viewer.id;
  return viewer.capabilities.includes("files.delete.any") || (own && viewer.capabilities.includes("files.delete.own"));
}

/** The file as the viewer sees it: uploader (name only), whether they may remove it, and the email record if any. */
export async function loadFileMeta(
  db: Db,
  file: FileRow,
  viewer: FileViewer,
  email?: EmailMessageRow | null,
): Promise<FileMeta> {
  const uploader = file.uploaded_by ? await findUploaderRef(db, file.uploaded_by) : null;
  return toFileMeta(file, {
    uploader,
    canDelete: canDeleteFile(viewer, file),
    email: email === undefined ? ((await findEmail(db, file.id)) ?? null) : email,
  });
}
