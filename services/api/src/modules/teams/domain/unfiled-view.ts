/** An inbound item as the Unfiled list shows it (contract TeamsUnfiledItem). Pure. */
import type { TeamsUnfiledItem } from "@kr/contracts";
import type { TeamsInboundItemRow } from "@kr/db";

export function unfiledProblem(
  row: Pick<TeamsInboundItemRow, "size_bytes" | "error_code">,
  uploadMaxBytes: number,
): TeamsUnfiledItem["problem"] {
  if (row.error_code === "malware") return "malware";
  if (row.error_code === "kind_not_accepted") return "kind_not_accepted";
  if (row.size_bytes !== null && Number(row.size_bytes) > uploadMaxBytes) return "too_large";
  return null;
}

export function toUnfiledItem(row: TeamsInboundItemRow, uploadMaxBytes: number): TeamsUnfiledItem {
  const folder = row.remote_path.split("/").slice(0, -1).join("/");
  return {
    itemId: row.drive_item_id,
    name: row.name,
    path: folder,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    addedBy: row.modified_by_name,
    modifiedAt: row.modified_at ? row.modified_at.toISOString() : null,
    seenAt: row.seen_at.toISOString(),
    problem: unfiledProblem(row, uploadMaxBytes),
  };
}
