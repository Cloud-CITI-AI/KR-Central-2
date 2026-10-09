import { inflateRawSync } from "node:zlib";

/** The files of a zip by path (folders are skipped), read from its central directory. Stored and deflated entries only. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const END = 0x06054b50;
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== END) end--;
  if (end < 0) throw new Error("Not a zip file: no end-of-central-directory record");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Bad central directory entry");
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + compressed);
    files.set(name, method === 0 ? data : inflateRawSync(data));
  }
  return files;
}
