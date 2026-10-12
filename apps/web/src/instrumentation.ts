import type { Instrumentation } from "next";

/**
 * Server render errors (a page, a route handler or a server action that threw) are logged as one JSON line with the request id of the
 * request and the digest of the error, so the id on the 500 page (`app/error.tsx`) finds its log line (PRODUCT_SPEC §4, §14).
 * Node.js only: the logger writes to `process.stderr`, which the edge runtime does not have (nothing here runs on the edge).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logServerError } = await import("@/lib/server-error-log");
  logServerError(error, request, context);
};
