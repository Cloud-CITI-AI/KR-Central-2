/**
 * Input guard (PRODUCT_SPEC §14 input validation): a NUL character (U+0000) in any string of the body, query or path
 * parameters is refused with a 400 validation problem naming the field. Postgres text cannot store U+0000 (22021), so
 * without this a signed-in user could turn any text field or search into a 500 that counts against the error-rate SLO.
 * Runs in preValidation, so authentication, CSRF and rate limits (onRequest) still answer first.
 */
import type { FastifyInstance } from "fastify";
import { BadRequestError, type FieldError } from "./errors.js";

export const NUL_MESSAGE = "Must not contain NUL (U+0000) characters";
/** Report at most this many fields; the first few are enough to fix the request. */
const MAX_REPORTED = 10;

/** Parsed JSON and query objects (Fastify's query object has a null-prototype ancestor); not buffers or streams. */
function isStructured(value: object): boolean {
  return (
    Array.isArray(value) || !(ArrayBuffer.isView(value) || typeof (value as { pipe?: unknown }).pipe === "function")
  );
}

function collect(value: unknown, path: string, out: FieldError[]): void {
  if (out.length >= MAX_REPORTED) return;
  if (typeof value === "string") {
    if (value.includes("\0")) out.push({ path, message: NUL_MESSAGE });
    return;
  }
  if (typeof value !== "object" || value === null || !isStructured(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (key.includes("\0")) out.push({ path: childPath, message: NUL_MESSAGE });
    collect(child, childPath, out);
  }
}

/** Field errors for every string in `parts` (body, query, params) that contains U+0000; empty when clean. */
export function findNulFields(parts: Readonly<Record<string, unknown>>): FieldError[] {
  const out: FieldError[] = [];
  for (const [context, value] of Object.entries(parts)) {
    if (typeof value === "string") {
      if (value.includes("\0")) out.push({ path: context, message: NUL_MESSAGE });
    } else collect(value, "", out);
  }
  return out;
}

export function registerInputGuard(app: FastifyInstance): void {
  app.addHook("preValidation", (request, _reply, done) => {
    const errors = findNulFields({ body: request.body, query: request.query, params: request.params });
    done(errors.length > 0 ? new BadRequestError({ errors }) : undefined);
  });
}
