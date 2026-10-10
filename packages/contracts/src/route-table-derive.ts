import type { HttpMethod, RouteDef } from "./routes.js";

/** `required`: the API answers 400/428 without it; `optional`: honoured when sent; `null`: not part of the route. */
export type HeaderRule = "required" | "optional" | null;

/** What the browser needs to know to call one operation (no schemas). */
export interface RouteTableEntry {
  readonly method: HttpMethod;
  readonly path: string;
  /** `X-CSRF-Token` header. */
  readonly csrf: boolean;
  readonly ifMatch: HeaderRule;
  readonly idempotencyKey: HeaderRule;
  /** multipart/form-data upload (sent with `uploadFile`, not `api()`). */
  readonly multipart: boolean;
}

type HeaderShape = Record<string, { safeParse(value: unknown): { success: boolean } } | undefined>;

function headerRule(route: RouteDef, name: string): HeaderRule {
  const headers = route.request?.headers as { shape: HeaderShape } | undefined;
  const header = headers?.shape[name];
  if (!header) return null;
  return header.safeParse(undefined).success ? "optional" : "required";
}

/** The table entry of every route, derived from the registry. Used by the generator and by the sync test. */
export function deriveRouteTable(routes: readonly RouteDef[]): Record<string, RouteTableEntry> {
  return Object.fromEntries(
    routes.map((route) => [
      route.operationId,
      {
        method: route.method,
        path: route.path,
        csrf: headerRule(route, "x-csrf-token") !== null,
        ifMatch: headerRule(route, "if-match"),
        idempotencyKey: headerRule(route, "idempotency-key"),
        multipart: route.request?.multipart === true,
      } satisfies RouteTableEntry,
    ]),
  );
}
