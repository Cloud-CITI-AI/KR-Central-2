/** Path helpers with no dependencies, so the browser client can use them without Zod (see routes-table.ts). */

/** "/v1/jobs/{jobId}" → "/v1/jobs/:jobId" */
export function toFastifyPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

/** Fill path params: buildPath("/v1/jobs/{jobId}", { jobId }) */
export function buildPath(path: string, params: Readonly<Record<string, string>>): string {
  return path.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new RangeError(`Missing path param ${k}`);
    return encodeURIComponent(v);
  });
}
