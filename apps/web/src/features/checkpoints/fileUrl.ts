import { apiPath } from "@/lib/api/client";

/** Same-origin URL of a file's content through the BFF (`GET /v1/files/{fileId}/content`, inline). Only clean files are served. */
export function fileContentUrl(fileId: string): string {
  return apiPath("getFileContent", { fileId });
}
