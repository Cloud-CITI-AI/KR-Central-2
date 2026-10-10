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
