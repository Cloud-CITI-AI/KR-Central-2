/** Job files texts, exactly as PRODUCT_SPEC §5.8 (the prototype's wording). Australian English. */
export const FILES_MESSAGES = {
  title: "Job files",
  none: "No files uploaded to this job yet",
  download: "Download all files (.zip)",
} as const;

/** "18 files across the stages above" (§5.8); "1 file" in the singular. */
export function countText(count: number): string {
  return `${count} file${count === 1 ? "" : "s"} across the stages above`;
}
