/** "50" for 52 428 800 bytes, "12.5" for 13 107 200: whole megabytes without a trailing ".0". */
export function formatMegabytes(bytes: number): string {
  return String(Number((bytes / (1024 * 1024)).toFixed(1)));
}
