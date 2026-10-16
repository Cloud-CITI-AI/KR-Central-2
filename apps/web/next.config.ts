import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Security headers that do not need a per-request nonce live here; the nonce-based Content-Security-Policy is set
 * per request in src/proxy.ts (FA-6/FE-12 — protected path, do not weaken).
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Safe because the CSP already limits every fetch, image, font and worker to this origin (data:/blob: aside).
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@kr/workflow", "@kr/contracts", "@kr/design-tokens"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
