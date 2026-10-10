/**
 * Schema-free route table: method, path template and header requirements of every operation, for the browser client.
 * `@kr/contracts/routes-table` is a separate entry point so the web bundle does not carry Zod and every schema just to
 * build a URL. This module must import nothing but other schema-free modules (routes-table.test.ts checks the import
 * graph); the table itself is generated from `ROUTES` (`pnpm openapi:generate`) and tested against it.
 */
import type { RouteTableEntry } from "./route-table-derive.js";
import { ROUTE_TABLE } from "./gen/routes-table.js";

export type { HeaderRule, RouteTableEntry } from "./route-table-derive.js";
export { ROUTE_TABLE } from "./gen/routes-table.js";
export { buildPath, toFastifyPath } from "./path.js";

export type RouteTableOperationId = keyof typeof ROUTE_TABLE;

export function getRouteEntry(operationId: RouteTableOperationId): RouteTableEntry {
  return ROUTE_TABLE[operationId];
}
