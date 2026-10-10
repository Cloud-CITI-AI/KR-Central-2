import type { FileMeta } from "@kr/contracts";

/** The files of a checkpoint that sit in the slot `key`. */
export function filesInSlot(files: readonly FileMeta[], key: string): FileMeta[] {
  return files.filter((file) => file.slot === key);
}

/** Files whose slot the checkpoint no longer defines ("Other files" of a slots panel). */
export function filesOutsideSlots(files: readonly FileMeta[], keys: readonly string[]): FileMeta[] {
  return files.filter((file) => file.slot === null || !keys.includes(file.slot));
}

/** Whether the API will serve and read the file: clean, or skipped when scanning is off (extraction and conformance reads need this). */
export function isReadable(file: FileMeta): boolean {
  return file.scanStatus === "clean" || file.scanStatus === "skipped";
}

/**
 * Whether a file satisfies a requirement chip ("✓ PDF received"): clean, skipped, or still being scanned. An infected file
 * or one that could not be scanned cannot be opened and has to be removed and uploaded again (§5.5), so it does not count.
 */
export function countsAsReceived(file: FileMeta): boolean {
  return file.scanStatus !== "infected" && file.scanStatus !== "error";
}
