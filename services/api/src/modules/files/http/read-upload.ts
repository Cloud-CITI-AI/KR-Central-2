/**
 * Reads one multipart upload without buffering it: text fields first, then the single `file` part, which is capped,
 * sniffed and streamed to storage while the sha256 is computed. Nothing is stored for a request that fails a check.
 */
import { randomUUID } from "node:crypto";
import { UploadFields } from "@kr/contracts";
import {
  SNIFF_BYTES,
  classifyContent,
  decodeMultipartFileName,
  objectKeyFor,
  sanitiseFileName,
  type ContentClassification,
} from "@kr/storage";
import type { ObjectStorage } from "@kr/storage";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  BadRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  type FieldError,
} from "../../../platform/errors.js";
import { assertAcceptedContent, resolveUploadTarget, type UploadTarget } from "../domain/upload-target.js";
import { capBytes, formatLimit, peek, type CapState } from "./stream-utils.js";

export interface StoredUpload {
  readonly fileId: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly classification: ContentClassification;
  readonly sha256: Buffer;
  readonly sizeBytes: number;
  readonly fields: z.output<typeof UploadFields>;
  readonly target: UploadTarget;
}

export interface ReadUploadOptions {
  readonly request: FastifyRequest;
  readonly storage: ObjectStorage;
  readonly log: FastifyBaseLogger;
  readonly jobId: string;
  readonly maxBytes: number;
  /** Called with the validated target BEFORE any byte of the file is read: authorise here (throw to refuse). */
  readonly authorise: (target: UploadTarget) => Promise<void>;
}

function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "fields", message: i.message }));
}

/** What busboy and Node streams say when the client's body is not valid multipart or ends early. */
const PARSE_MESSAGES = [
  "Multipart: Boundary not found",
  "Unexpected end of multipart data",
  "Unexpected end of form",
  "Malformed part header",
  "Malformed urlencoded form",
  "Missing Content-Type",
  "Part terminator not found",
];

/** True for a failure of the multipart body itself (not a storage, database or limit error). */
export function isMultipartParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: unknown }).code === "ERR_STREAM_PREMATURE_CLOSE") return true;
  return PARSE_MESSAGES.some((m) => error.message.startsWith(m));
}

/**
 * Throws the problem for the first failed check. When the object was already written (a later part of the request
 * was wrong, or the caller's transaction failed) the caller removes it with `discard`.
 */
export async function readUpload(o: ReadUploadOptions): Promise<StoredUpload> {
  const { request } = o;
  if (!request.isMultipart()) throw new UnsupportedMediaTypeError({ detail: "Send the file as multipart/form-data." });
  const rawFields: Record<string, string> = {};
  let stored: StoredUpload | undefined;
  try {
    for await (const part of request.parts()) {
      if (stored) {
        throw new BadRequestError({
          errors: [{ path: "file", message: "Send one file per request, after the fields." }],
        });
      }
      if (part.type === "field") {
        if (typeof part.value !== "string") continue;
        rawFields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== "file") {
        throw new BadRequestError({
          errors: [{ path: part.fieldname, message: 'The file part must be named "file".' }],
        });
      }
      const parsed = UploadFields.safeParse(rawFields);
      if (!parsed.success) throw new BadRequestError({ errors: fieldErrors(parsed.error) });
      const target = resolveUploadTarget(parsed.data);
      await o.authorise(target);
      stored = await storeFile(o, part, parsed.data, target);
    }
  } catch (error) {
    if (stored) await discard(o.storage, o.log, stored.storageKey);
    // A body that is not valid multipart, or ends early, is the client's mistake (§14), not a server failure.
    if (isMultipartParseError(error))
      throw new BadRequestError({ detail: "The request could not be parsed.", cause: error });
    throw error;
  }
  if (!stored) throw new BadRequestError({ errors: [{ path: "file", message: "Choose a file to upload." }] });
  return stored;
}

async function storeFile(
  o: ReadUploadOptions,
  part: MultipartFile,
  fields: z.output<typeof UploadFields>,
  target: UploadTarget,
): Promise<StoredUpload> {
  const originalName = sanitiseFileName(decodeMultipartFileName(part.filename));
  const cap: CapState = { exceeded: false, bytes: 0 };
  const tooLarge = `${originalName} is larger than ${formatLimit(o.maxBytes)}.`;
  const { head, stream } = await peek(capBytes(part.file, o.maxBytes, cap, tooLarge), SNIFF_BYTES);
  const fileId = randomUUID();
  const storageKey = objectKeyFor(o.jobId, fileId);
  try {
    const classification = await classifyContent(head, originalName);
    assertAcceptedContent(classification, target.accept);
    const result = await o.storage.put({ key: storageKey, body: stream, contentType: classification.contentType });
    return {
      fileId,
      storageKey,
      originalName,
      classification,
      sha256: Buffer.from(result.sha256, "hex"),
      sizeBytes: result.size,
      fields,
      target,
    };
  } catch (error) {
    stream.destroy();
    await discard(o.storage, o.log, storageKey);
    // The storage adapter may wrap the stream's failure; the cap flag says what really happened.
    if (cap.exceeded && !(error instanceof PayloadTooLargeError)) throw new PayloadTooLargeError({ detail: tooLarge });
    throw error;
  }
}

/** Remove an object that no file row will ever point to. A failure to remove it is logged. */
export async function discard(storage: ObjectStorage, log: FastifyBaseLogger, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    // The object is private and nothing points to it; log it so an operator can remove it.
    log.warn({ event: "orphan_object", key, err: error }, "Could not remove an unreferenced upload");
  }
}
