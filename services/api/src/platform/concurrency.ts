/** Optimistic concurrency (PRODUCT_SPEC §14, DATA_MODEL §6): `If-Match: "<version>"`, missing → 428, stale → 412. */
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyReply } from "fastify";
import { BadRequestError, PreconditionFailedError, PreconditionRequiredError } from "./errors.js";

/** Parse the If-Match header into the version the client last saw. */
export function parseIfMatch(headers: IncomingHttpHeaders): number {
  const raw = headers["if-match"];
  if (raw === undefined)
    throw new PreconditionRequiredError({ detail: "Send the current version in the If-Match header." });
  const m = typeof raw === "string" ? /^"(\d{1,9})"$/.exec(raw) : null;
  if (!m?.[1]) throw new BadRequestError({ detail: 'If-Match must be a quoted version number, e.g. "3".' });
  return Number(m[1]);
}

export function formatEtag(version: number): string {
  return `"${version}"`;
}

export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header("etag", formatEtag(version));
}

/** For repositories that load before writing: stale version → 412 (the SQL `WHERE version = $n` guard is the real lock). */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
  }
}
