import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

describe("buildCsp", () => {
  it("is exactly the ADR-0005 policy with the nonce", () => {
    expect(buildCsp("abc")).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'nonce-abc'; " +
        "style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; " +
        "worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  it("allows eval only in development", () => {
    expect(buildCsp("abc", { dev: true })).toContain("'strict-dynamic' 'unsafe-eval';");
    expect(buildCsp("abc")).not.toContain("unsafe-eval");
  });
});

describe("generateNonce", () => {
  it("is unique, base64 and 128 bits", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});
