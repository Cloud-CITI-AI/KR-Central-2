/** Test support: synthetic file bytes the sniffer accepts and a multipart body builder (TD-1: no real documents). */
import { createHash } from "node:crypto";
import type { FileRow } from "@kr/db";
import type { LightMyRequestResponse } from "fastify";
import yauzl from "yauzl";
import type { Factories } from "../../../test/factories.js";
import { apiRequest, type SignedIn, type TestApp } from "../../../test/helpers/index.js";

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const bytes = (...parts: (string | readonly number[])[]): Buffer =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

/** A PDF header plus `padding` filler bytes (enough for the sniffer; not renderable). */
export const pdfBytes = (padding = 64, tag = ""): Buffer =>
  bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", `% ${tag}\n`, zeros(padding));
export const pngBytes = (): Buffer =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", zeros(21), "IEND", zeros(4));

export const mp4Bytes = (): Buffer => bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0], "isomiso2", zeros(40));
export const dwgBytes = (): Buffer => bytes("AC1032", [0, 0, 0, 0, 0, 1], zeros(60));
export const textBytes = (text = "Synthetic note\n"): Buffer => Buffer.from(text);
/** Outlook message magic (the worker confirms it by parsing). */
export const msgBytes = (): Buffer => bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], zeros(100));
export const emlBytes = (): Buffer =>
  Buffer.from("From: Sam <sam@example.test>\r\nTo: kr@example.test\r\nSubject: Query\r\n\r\nPlease explain.\r\n");

export interface UploadPart {
  readonly name: string;
  readonly data: Buffer;
  /** Form field name; "file" unless a test sends a wrong one. */
  readonly field?: string;
}

/** Parts a well-behaved client never sends: fields after the file, a second file. */
export interface MalformedParts {
  readonly trailingFields?: Readonly<Record<string, string>>;
  readonly extraFile?: UploadPart;
}

const BOUNDARY = "----krtestboundary7f3a9c";

const fieldPart = (name: string, value: string) =>
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8");
const filePart = (p: UploadPart): Buffer[] => [
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.field ?? "file"}"; filename="${p.name}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
    "utf8",
  ),
  p.data,
  Buffer.from("\r\n"),
];

/** The raw body and content type of a multipart/form-data request: fields first, then the file. */
export function multipartBody(fields: Readonly<Record<string, string>>, file?: UploadPart, more: MalformedParts = {}) {
  const chunks: Buffer[] = Object.entries(fields).map(([k, v]) => fieldPart(k, v));
  if (file) chunks.push(...filePart(file));
  for (const [k, v] of Object.entries(more.trailingFields ?? {})) chunks.push(fieldPart(k, v));
  if (more.extraFile) chunks.push(...filePart(more.extraFile));
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

export interface UploadCall extends MalformedParts {
  readonly jobId: string;
  readonly as?: SignedIn;
  readonly fields?: Readonly<Record<string, string>>;
  readonly file?: UploadPart;
  readonly headers?: Readonly<Record<string, string>>;
}

export function uploadFile(t: Pick<TestApp, "app">, c: UploadCall): Promise<LightMyRequestResponse> {
  const { payload, headers } = multipartBody(c.fields ?? {}, c.file, c);
  return apiRequest(t, {
    method: "POST",
    url: `/v1/jobs/${c.jobId}/files`,
    ...(c.as ? { as: c.as } : {}),
    body: payload,
    headers: { ...headers, ...c.headers },
  });
}

export interface SeedFile {
  readonly jobId: string;
  readonly data: Buffer;
  readonly name?: string;
  readonly kind?: FileRow["kind"];
  readonly contentType?: string;
  readonly scanStatus?: FileRow["scan_status"];
  readonly checkpointKey?: string;
  readonly slot?: string;
  readonly conditionId?: string;
  readonly uploadedBy?: string;
}

/** A files row with its object in the test storage, as the worker leaves it after a scan (clean unless told). */
export async function seedFile(t: Pick<TestApp, "db" | "storage">, f: Factories, o: SeedFile): Promise<FileRow> {
  const contentType = o.contentType ?? "application/pdf";
  const row = await f.makeFile({
    jobId: o.jobId,
    kind: o.kind ?? "pdf",
    name: o.name ?? "Plan.pdf",
    ...(o.checkpointKey ? { checkpointKey: o.checkpointKey } : {}),
    ...(o.slot ? { slot: o.slot } : {}),
    ...(o.conditionId ? { conditionId: o.conditionId } : {}),
    ...(o.uploadedBy ? { uploadedBy: o.uploadedBy } : {}),
    ...(o.scanStatus ? { scanStatus: o.scanStatus } : {}),
  });
  await t.storage.put({ key: row.storage_key, body: o.data, contentType });
  return t.db
    .updateTable("files")
    .set({
      content_type: contentType,
      size_bytes: o.data.length,
      sha256: createHash("sha256").update(o.data).digest(),
    })
    .where("id", "=", row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The entries of a zip, in archive order, with their bytes (read with yauzl, like any extractor would). */
export function readZip(zip: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (error, archive) => {
      if (error) {
        reject(error);
        return;
      }
      const entries = new Map<string, Buffer>();
      archive.on("error", reject);
      archive.on("end", () => {
        resolve(entries);
      });
      archive.on("entry", (entry: yauzl.Entry) => {
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });
}
