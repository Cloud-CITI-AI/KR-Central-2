import { ROUTES, type RouteDef } from "@kr/contracts";

/** Uploads (multipart) and downloads (zip, file bytes) stream for as long as the transfer takes: no 30 s cap (§14). */
const STREAMING_ROUTES = (ROUTES as readonly RouteDef[])
  .filter(
    (route) =>
      route.request?.multipart === true ||
      Object.values(route.responses).some((r) => r.contentType !== undefined && !r.contentType.includes("json")),
  )
  .map((route) => ({ method: route.method, segments: route.path.split("/") }));

/** `apiPath` is the API path, e.g. "/v1/files/<id>/content". Registry paths use `{param}` placeholders. */
export function isStreamingRequest(method: string, apiPath: string): boolean {
  const parts = apiPath.split("/");
  return STREAMING_ROUTES.some(
    (route) =>
      route.method === method &&
      route.segments.length === parts.length &&
      route.segments.every((seg, i) => (seg.startsWith("{") ? Boolean(parts[i]) : seg === parts[i])),
  );
}
