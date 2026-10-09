import type { FileMeta } from "@kr/contracts";

/** The files of a checkpoint that sit in the slot `key`. */
export function filesInSlot(files: readonly FileMeta[], key: string): FileMeta[] {
  return files.filter((file) => file.slot === key);
}

/** Files whose slot the checkpoint no longer defines ("Other files" of a slots panel). */
export function filesOutsideSlots(files: readonly FileMeta[], keys: readonly string[]): FileMeta[] {
  return files.filter((file) => file.slot === null || !keys.includes(file.slot));
}
