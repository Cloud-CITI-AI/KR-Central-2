// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";
import { PDFJS_BASE, PDFJS_WORKER_SRC } from "./pdf-renderer";

const web = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const vendored = (path: string) => join(web, "public", PDFJS_BASE, path);
const installed = (path: string) => join(web, "node_modules/pdfjs-dist", path);

describe("public/pdfjs", () => {
  it("serves the worker the renderer points at, byte for byte the installed pdfjs-dist (refresh it on a version bump)", () => {
    expect(PDFJS_WORKER_SRC).toBe(`${PDFJS_BASE}pdf.worker.min.mjs`);
    expect(
      readFileSync(vendored("pdf.worker.min.mjs")).equals(readFileSync(installed("build/pdf.worker.min.mjs"))),
    ).toBe(true);
  });

  it.each(["cmaps", "standard_fonts", "iccs"])("has every %s file of the installed pdfjs-dist", (folder) => {
    expect(readdirSync(vendored(folder)).sort()).toEqual(readdirSync(installed(folder)).sort());
  });

  it("has the wasm decoders and licences, without the scripting engine or the non-wasm fallbacks", () => {
    const files = readdirSync(vendored("wasm"));
    expect(files).toEqual(expect.arrayContaining(["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"]));
    expect(files.filter((f) => f.startsWith("quickjs") || f.endsWith(".js"))).toEqual([]);
    expect(readFileSync(vendored("LICENSE"), "utf8")).toContain("Apache License");
  });

  it("is allowed by the CSP: same-origin worker, no eval for scripts", () => {
    const csp = buildCsp("nonce");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain("unsafe-eval");
  });
});
