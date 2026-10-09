import { describe, expect, it } from "vitest";
import { judgeScanError, mayRescan, type ScanErrorKind } from "./scan.js";

describe("judgeScanError", () => {
  it("lets the queue retry a scanner that is down until the last attempt", () => {
    expect(judgeScanError("connection", 1, 3)).toEqual({
      detail: "The virus scanner could not be reached.",
      final: false,
    });
    expect(judgeScanError("timeout", 2, 3).final).toBe(false);
    expect(judgeScanError("connection", 3, 3).final).toBe(true);
  });

  it("records an error at once when retrying cannot help", () => {
    expect(judgeScanError("size_limit", 1, 3).final).toBe(true);
    expect(judgeScanError("object_missing", 1, 3).final).toBe(true);
  });

  it("describes every kind with its own fixed text", () => {
    const detail = (kind: ScanErrorKind): string => judgeScanError(kind, 1, 1).detail;
    expect(
      Object.fromEntries(
        (
          ["connection", "timeout", "size_limit", "scanner_error", "protocol", "object_missing", "storage"] as const
        ).map((k) => [k, detail(k)]),
      ),
    ).toEqual({
      connection: "The virus scanner could not be reached.",
      timeout: "The virus scan timed out.",
      size_limit: "The file is larger than the virus scanner accepts.",
      scanner_error: "The virus scanner reported an error.",
      protocol: "The virus scanner gave an unexpected answer.",
      object_missing: "The stored file could not be found.",
      storage: "The stored file could not be read.",
    });
  });
});

describe("mayRescan", () => {
  it("re-scans after each of the first SCAN_ERROR_MAX_RETRIES failures and then stops", () => {
    expect([1, 2, 3, 4].map((failed) => mayRescan(failed, 3))).toEqual([true, true, true, false]);
    expect(mayRescan(0, 3)).toBe(false);
    expect(mayRescan(1, 0)).toBe(false);
  });
});
