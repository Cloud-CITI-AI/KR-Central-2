/**
 * Response hardening of the API (ADR-0002, ADR-0005, ASVS V3/V16): the same security headers on every answer, no
 * framework fingerprint, no CORS, content served so a browser cannot run it, and errors that say nothing about internals.
 * Known gap, reported in docs/security/findings.md (D-2): a path parameter over 100 characters is answered by Fastify's own
 * 414 (JSON, not problem+json) before the platform hooks run.
 */
import { ROUTES } from "@kr/contracts";
import type { FileRow } from "@kr/db";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dwgBytes,
  emlBytes,
  mp4Bytes,
  pdfBytes,
  pngBytes,
  seedFile,
  textBytes,
} from "../../src/modules/files/testing.js";
import { apiRequest } from "../helpers/index.js";
import { createWorld, urlFor, type World } from "./support.js";

const API_CSP = "default-src 'none';frame-ancestors 'none'";
const SANDBOX = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
const BASELINE = {
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "x-permitted-cross-domain-policies": "none",
};
const ABSENT = [
  "x-powered-by",
  "server",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
];

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.t.close();
});

function expectHardened(res: LightMyRequestResponse, label: string, csp = API_CSP): void {
  expect(res.headers, label).toMatchObject(BASELINE);
  expect(res.headers["content-security-policy"], label).toBe(csp);
  expect(res.headers["x-request-id"], label).toMatch(/^[\w.-]{8,64}$/);
  for (const name of ABSENT) expect(res.headers[name], `${label} ${name}`).toBeUndefined();
}

describe("every kind of answer carries the baseline", () => {
  it("answers each contract route, with and without a session, with the headers, no-store caching and no fingerprint", async () => {
    for (const route of ROUTES) {
      const anon = await w.t.app.inject({ method: route.method === "GET" ? "GET" : route.method, url: urlFor(route) });
      expectHardened(anon, `${route.operationId} anonymous`);
      if (anon.statusCode >= 400) expect(anon.headers["cache-control"], route.operationId).toBe("no-store");
    }
    for (const [url, as] of [
      ["/v1/me", w.actors.staff],
      ["/v1/jobs", w.actors.client],
      ["/v1/jobs/2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77", w.actors.admin],
    ] as const) {
      const res = await apiRequest(w.t, { url, as });
      expectHardened(res, url);
      expect(res.headers["cache-control"], url).toBe("no-store");
    }
  });

  it("gives problems their own media type and a short, fixed shape: no stack, SQL, paths or secrets", async () => {
    const send = (
      method: "GET" | "POST" | "PATCH",
      url: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => apiRequest(w.t, { method, url, as: w.actors.admin, ...(body === undefined ? {} : { body }), headers });
    const hostile = [
      send("GET", "/v1/jobs/not-a-uuid"),
      send("GET", "/v1/jobs/%00"),
      send("GET", "/v1/jobs?limit=abc&cursor=%27%3B--"),
      send("GET", `/v1/files/${"a".repeat(90)}`),
      send("POST", "/v1/jobs", "{not json", { "content-type": "application/json" }),
      send("POST", "/v1/jobs", "a=b", { "content-type": "application/x-www-form-urlencoded" }),
      send("PATCH", "/v1/users/2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77", '{"__proto__":{"role":"admin"}}', {
        "content-type": "application/json",
      }),
      send("GET", "/v1/jobs/2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77/notes?limit=1e99"),
    ];
    for (const [i, res] of (await Promise.all(hostile)).entries()) {
      expect(res.statusCode, `case ${i}: ${res.body.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.headers["content-type"], `case ${i}`).toContain("application/problem+json");
      const body = res.json<Record<string, unknown>>();
      expect(
        Object.keys(body).every((k) =>
          ["type", "title", "status", "detail", "instance", "requestId", "errors"].includes(k),
        ),
      ).toBe(true);
      expect(res.body).not.toMatch(/\bat \S+ \(|node_modules|SELECT |INSERT |postgres|\.ts:\d+|stack/i);
    }
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });

  it("offers no CORS: a cross-origin preflight or request gets no allow headers and no credentials", async () => {
    for (const method of ["OPTIONS", "GET"] as const) {
      const res = await w.t.app.inject({
        method,
        url: "/v1/jobs",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
          cookie: w.actors.admin.cookie,
        },
      });
      for (const name of ABSENT) expect(res.headers[name], `${method} ${name}`).toBeUndefined();
      expect(res.headers).not.toHaveProperty("access-control-allow-headers");
    }
  });
});

describe("file content (PRODUCT_SPEC 11): nothing a browser could run", () => {
  const kinds: [string, Buffer, FileRow["kind"], string, string, "inline" | "attachment", string][] = [
    ["a PDF", pdfBytes(), "pdf", "application/pdf", "Plan.pdf", "inline", API_CSP],
    ["an image", pngBytes(), "image", "image/png", "Photo.png", "inline", SANDBOX],
    ["a video", mp4Bytes(), "video", "video/mp4", "Clip.mp4", "inline", SANDBOX],
    ["text", textBytes("<b>x</b>"), "text", "text/plain", "Notes.txt", "inline", SANDBOX],
    ["a drawing", dwgBytes(), "dwg", "application/octet-stream", "Plan.dwg", "attachment", SANDBOX],
    ["an email", emlBytes(), "email", "message/rfc822", "Query.eml", "attachment", SANDBOX],
  ];
  it.each(kinds)("%s", async (_n, data, kind, contentType, name, disposition, csp) => {
    const job = await w.freshJob();
    const file = await seedFile(w.t, w.f, { jobId: job.id, data, kind, contentType, name });
    const res = await apiRequest(w.t, { url: `/v1/files/${file.id}/content?disposition=inline`, as: w.actors.client });
    expect(res.statusCode).toBe(200);
    expectHardened(res, name, csp);
    expect(res.headers["content-type"]).toBe(kind === "text" ? "text/plain; charset=utf-8" : contentType);
    expect(String(res.headers["content-disposition"]).startsWith(`${disposition}; filename="${name}"`)).toBe(true);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    // Asking for "inline" never turns a download-only kind into a page.
    const download = await apiRequest(w.t, {
      url: `/v1/files/${file.id}/content?disposition=attachment`,
      as: w.actors.client,
    });
    expect(download.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("serves a byte range with 206 and Content-Range, under the same headers", async () => {
    const job = await w.freshJob();
    const file = await seedFile(w.t, w.f, {
      jobId: job.id,
      data: mp4Bytes(),
      kind: "video",
      contentType: "video/mp4",
      name: "Clip.mp4",
    });
    const res = await apiRequest(w.t, {
      url: `/v1/files/${file.id}/content`,
      as: w.actors.staff,
      headers: { range: "bytes=0-9" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toMatch(/^bytes 0-9\/\d+$/);
    expectHardened(res, "range", SANDBOX);
  });

  it("serves the package as a download, and no file name can break out of the header", async () => {
    const job = await w.freshJob();
    await seedFile(w.t, w.f, { jobId: job.id, data: pdfBytes(), name: 'a"b\r\nSet-Cookie: x=1.pdf' });
    const res = await apiRequest(w.t, { url: `/v1/jobs/${job.id}/package`, as: w.actors.staff });
    expect(res.statusCode).toBe(200);
    expectHardened(res, "package");
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
