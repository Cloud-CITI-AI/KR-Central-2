import type { OperationId, Route } from "@kr/contracts";
import type { z } from "zod";

type RouteOf<Id extends OperationId> = Extract<Route, { operationId: Id }>;
type RequestOf<Id extends OperationId> = RouteOf<Id> extends { request: infer R } ? R : unknown;
type InputOf<Id extends OperationId, K extends string> =
  RequestOf<Id> extends Record<K, infer S extends z.ZodType> ? z.input<S> : never;
type Has<Id extends OperationId, K extends string> = K extends keyof RequestOf<Id> ? true : false;

/** Operations callable through `api()`: proxied `/v1` routes with a JSON body (uploads use `uploadFile`). */
export type ApiOperationId = Exclude<
  Extract<Route, { path: `/v1/${string}` }>["operationId"],
  Extract<Route, { request: { multipart: true } }>["operationId"]
>;

interface Common {
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}
type Required_<Id extends OperationId> = (Has<Id, "params"> extends true
  ? { readonly params: InputOf<Id, "params"> }
  : unknown) &
  (Has<Id, "body"> extends true ? { readonly body: InputOf<Id, "body"> } : unknown);
type Optional_<Id extends OperationId> =
  Has<Id, "query"> extends true ? { readonly query?: InputOf<Id, "query"> } : unknown;

export type ApiOptions<Id extends OperationId> = Required_<Id> & Optional_<Id> & Common;
export type ApiArgs<Id extends OperationId> =
  Has<Id, "params"> extends true
    ? [options: ApiOptions<Id>]
    : Has<Id, "body"> extends true
      ? [options: ApiOptions<Id>]
      : [options?: ApiOptions<Id>];

type SchemaAt<R, S extends number> = R extends { responses: Record<S, { schema: infer Z extends z.ZodType }> }
  ? Z
  : never;
type SuccessSchema<Id extends OperationId> = [
  SchemaAt<RouteOf<Id>, 200>,
  SchemaAt<RouteOf<Id>, 201>,
  SchemaAt<RouteOf<Id>, 202>,
][number];

/** The parsed success body, or `undefined` for 204 / non-JSON responses. */
export type ApiResult<Id extends OperationId> = [SuccessSchema<Id>] extends [never]
  ? undefined
  : z.output<SuccessSchema<Id>>;
