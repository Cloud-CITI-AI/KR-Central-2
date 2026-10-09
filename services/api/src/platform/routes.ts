/**
 * defineRoute: the only way a module registers an HTTP route. Method, path, params/query/body/headers and response
 * schemas all come from ROUTES[operationId] (packages/contracts), so handlers cannot drift from the contract, and the
 * platform applies the cross-cutting rules (session required, If-Match, authz-was-checked) in one place.
 */
import { ROUTES, getRoute, toFastifyPath, type OperationId, type Route, type RouteDef } from "@kr/contracts";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "./auth-context.js";
import { UnauthenticatedError, requestInstance, toProblem } from "./errors.js";
import { parseIfMatch } from "./concurrency.js";

type RouteOf<Id extends OperationId> = Extract<Route, { operationId: Id }>;
type Part<Id extends OperationId, K extends string> =
  RouteOf<Id> extends { request: infer Q }
    ? Q extends Record<K, infer S extends z.ZodType>
      ? Q extends { multipart: true }
        ? K extends "body"
          ? undefined
          : z.output<S>
        : z.output<S>
      : undefined
    : undefined;
type SuccessBody<Id extends OperationId> = {
  [S in keyof RouteOf<Id>["responses"] & (200 | 201 | 202)]: RouteOf<Id>["responses"][S] extends {
    schema: infer Z extends z.ZodType;
  }
    ? z.output<Z>
    : never;
}[keyof RouteOf<Id>["responses"] & (200 | 201 | 202)];
/** "required" when the contract declares `if-match: string`, "optional" for `if-match?: string`, else "none". */
type IfMatchMode<Id extends OperationId> =
  RouteOf<Id> extends { request: { headers: z.ZodType<{ "if-match": string }> } }
    ? "required"
    : RouteOf<Id> extends { request: { headers: infer H extends z.ZodType } }
      ? "if-match" extends keyof z.output<H>
        ? "optional"
        : "none"
      : "none";

/** Everything a handler needs, already validated against the contract. */
export interface RouteContext<Id extends OperationId> {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly params: Part<Id, "params">;
  readonly query: Part<Id, "query">;
  readonly body: Part<Id, "body">;
  /** Authenticated caller; always set on `auth: "session"` routes, null on public ones. */
  readonly auth: RouteOf<Id>["auth"] extends "session" ? AuthContext : AuthContext | null;
  /**
   * Version parsed from `If-Match`. Required header: missing → 428. Optional header (updateUser): checked when sent
   * (malformed → 400) and `undefined` when absent, never 428. No header in the contract: always `undefined`.
   */
  readonly expectedVersion: { required: number; optional: number | undefined; none: undefined }[IfMatchMode<Id>];
}

export type RouteHandler<Id extends OperationId> = (ctx: RouteContext<Id>) => Promise<SuccessBody<Id> | FastifyReply>;

/** Headers the platform enforces centrally (CSRF hook, If-Match parsing, idempotency); not validated by zod. */
const PLATFORM_HEADERS = new Set(["x-csrf-token", "if-match", "idempotency-key"]);

function remainingHeaderSchema(schema: z.ZodType | undefined): z.ZodType | undefined {
  if (!(schema instanceof z.ZodObject)) return schema;
  const shape = schema.shape as Record<string, z.ZodType>;
  const keep = Object.entries(shape).filter(([k]) => !PLATFORM_HEADERS.has(k));
  return keep.length ? z.object(Object.fromEntries(keep)) : undefined;
}

/** Only successful, JSON-bodied responses are serialised through zod; problem responses are built by the error handler. */
function responseSchemas(responses: RouteDef["responses"]): Record<number, z.ZodType> {
  const out: Record<number, z.ZodType> = {};
  for (const [status, def] of Object.entries(responses) as [string, { schema?: z.ZodType; contentType?: string }][]) {
    if (def.schema && !def.contentType) out[Number(status)] = def.schema;
  }
  return out;
}

export function defineRoute<Id extends OperationId>(
  app: FastifyInstance,
  operationId: Id,
  handler: RouteHandler<Id>,
): void {
  const def = getRoute(operationId);
  const request = def.request;
  const headers = remainingHeaderSchema(request?.headers);
  // The lowest non-error status: 200/201/202 for JSON routes, 302 for the redirecting auth routes.
  const defaultStatus = Math.min(
    ...Object.keys(def.responses)
      .map(Number)
      .filter((s) => s >= 200 && s < 400),
  );
  const headerShape: Readonly<Record<string, z.ZodType | undefined>> =
    request?.headers instanceof z.ZodObject ? request.headers.shape : {};
  const ifMatchField = headerShape["if-match"];
  const wantsIfMatch = ifMatchField !== undefined;
  // A contract that marks the header optional (updateUser) is checked when sent and never answered with 428.
  const ifMatchOptional = ifMatchField?.safeParse(undefined).success ?? false;
  const schema = {
    ...(request?.params ? { params: request.params } : {}),
    ...(request?.query ? { querystring: request.query } : {}),
    ...(request?.body && !request.multipart ? { body: request.body } : {}),
    ...(headers ? { headers } : {}),
    response: responseSchemas(def.responses),
  };

  app.route({
    method: def.method,
    url: toFastifyPath(def.path),
    config: { operationId },
    schema,
    handler: async (req, reply) => {
      const auth = req.auth;
      if (def.auth === "session" && !auth) throw new UnauthenticatedError();
      reply.code(defaultStatus);
      const ctx = {
        request: req,
        reply,
        params: req.params,
        query: req.query,
        body: req.body,
        auth,
        expectedVersion:
          wantsIfMatch && !(ifMatchOptional && req.headers["if-match"] === undefined)
            ? parseIfMatch(req.headers)
            : undefined,
      } as unknown as RouteContext<Id>;
      return handler(ctx);
    },
    // Deny by default (BE-5). This runs for every response, whether the handler returned a body or sent one through
    // the reply (as `sendIdempotent` does), and before any byte leaves the process. It detects a session route that
    // never called an authz helper and blocks its response; it cannot undo side effects the handler already had, so
    // handlers must still check before they write.
    onSend: async (req, reply, payload) => {
      const auth = req.auth;
      if (def.auth !== "session" || !auth || auth.authzChecked || reply.statusCode >= 400) return payload;
      req.log.error({ event: "authz_missing", operationId }, "Handler finished without an authorisation check");
      if (payload instanceof Readable) payload.destroy();
      const { problem } = toProblem(new Error("authz_missing"), req.id, requestInstance(req));
      for (const h of [
        "location",
        "set-cookie",
        "etag",
        "content-disposition",
        "content-length",
        "idempotent-replayed",
      ]) {
        void reply.removeHeader(h);
      }
      void reply.code(problem.status).type("application/problem+json");
      return JSON.stringify(problem);
    },
  });
}

/** Operations registered on this app (collected by the onRoute hook installed by trackOperations). */
const registered = new WeakMap<FastifyInstance, Set<string>>();

export function trackOperations(app: FastifyInstance): void {
  const set = new Set<string>();
  registered.set(app, set);
  app.addHook("onRoute", (route) => {
    const id = route.config?.operationId;
    if (id) set.add(id);
  });
}

export function registeredOperations(app: FastifyInstance): ReadonlySet<string> {
  return registered.get(app) ?? new Set();
}

/** Declared in the contract but not registered (WP-20 makes an empty result mandatory). */
export function unregisteredOperations(app: FastifyInstance): OperationId[] {
  const have = registeredOperations(app);
  return ROUTES.map((r) => r.operationId).filter((id) => !have.has(id));
}
