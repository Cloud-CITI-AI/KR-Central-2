/** Test support: synthetic file bytes the sniffer accepts and a multipart body builder (TD-1: no real documents). */
import type { LightMyRequestResponse } from "fastify";
import { apiRequest, type SignedIn, type TestApp } from "../../../test/helpers/index.js";

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const bytes = (...parts: (string | readonly number[])[]): Buffer =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

/** A PDF header plus `padding` filler bytes (enough for the sniffer; not renderable). */
export const pdfBytes = (padding = 64, tag = ""): Buffer =>
  bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", `% ${tag}\n`, zeros(padding));
export const pngBytes = (): Buffer =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", zeros(21), "IEND", zeros(4));

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
