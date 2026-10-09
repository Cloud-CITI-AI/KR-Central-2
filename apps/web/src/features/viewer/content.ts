import { buildPath, getRoute } from "@kr/contracts";
import { API_BASE } from "@/lib/api/client";

/** Same-origin URL of a file's bytes through the BFF (ADR-0005). The browser sends the session cookie itself. */
export function contentUrl(fileId: string, disposition: "inline" | "attachment" = "inline"): string {
  const path = `${API_BASE}${buildPath(getRoute("getFileContent").path, { fileId })}`;
  return disposition === "attachment" ? `${path}?disposition=attachment` : path;
}
