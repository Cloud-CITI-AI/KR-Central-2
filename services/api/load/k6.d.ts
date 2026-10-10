// The slice of the k6 runtime API that smoke.js uses (k6 ships no npm types here and dependencies are not added for a
// smoke test). k6 modules load at run time inside k6, never from node_modules.
declare module "k6/http" {
  interface Params {
    headers?: Record<string, string>;
    tags?: Record<string, string>;
  }
  export interface Response {
    status: number;
    json(selector?: string): unknown;
  }
  const http: { get(url: string, params?: Params): Response };
  export default http;
}
declare module "k6" {
  export function check<T>(value: T, checks: Record<string, (value: T) => boolean>): boolean;
  export function fail(message: string): never;
}
