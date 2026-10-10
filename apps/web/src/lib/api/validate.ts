import type { UploadedFile } from "./upload";
import { getRoute, UploadResult, type OperationId } from "@kr/contracts";

/**
 * Parse a response body with the contract's schema for its status (development and tests; see `validateResponses` in
 * client.ts). Loaded on demand because it pulls in Zod and every schema of `@kr/contracts`.
 */
export function parseResponse(operationId: OperationId, status: number, json: unknown): unknown {
  const route = getRoute(operationId);
  const schema = (route.responses[status] ?? route.responses[200])?.schema;
  return schema ? schema.parse(json) : json;
}

/** The stored file an upload answers with (`UploadResult`). Loaded on demand like `parseResponse`. */
export function parseUploadResult(json: unknown): UploadedFile {
  return UploadResult.parse(json);
}
