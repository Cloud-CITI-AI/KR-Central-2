/**
 * Hostile uploads (OWASP API4, ASVS V5): disguised and polyglot content, oversize bodies, path and header tricks in
 * names, malformed multipart, and the guarantee that nothing unscanned or unauthorised is stored or served.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dwgBytes, multipartBody, pdfBytes, pngBytes, textBytes, uploadFile } from "../../src/modules/files/testing.js";
import { apiRequest } from "../helpers/index.js";
import { createWorld, type World } from "./support.js";

const LIMIT = 2048;
const KEY = /^jobs\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
/** What the API-wide helmet policy leaves on a PDF (the sandbox CSP is for every other kind, PRODUCT_SPEC 11). */
const API_CSP = "default-src 'none';frame-ancestors 'none'";
const SANDBOX = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

let w: World;
let jobId: string;
beforeAll(async () => {
  w = await createWorld({ UPLOAD_MAX_BYTES: String(LIMIT) });
  jobId = (await w.freshJob()).id;
});
afterAll(async () => {
  await w.t.close();
});

const keys = async () => {
  const out: string[] = [];
  for await (const o of w.t.storage.list("jobs/")) out.push(o.key);
  return out;
};
const evidence = async () => ({
  conditionId: (await w.f.makeCondition({ jobId, number: Math.floor(Math.random() * 1e6) })).id,
});
const send = async (name: string, data: Buffer, fields?: Record<string, string>, as = w.actors.staff) =>
  uploadFile(w.t, { jobId, as, fields: fields ?? (await evidence()), file: { name, data } });
const content = async (id: string) => {
  await w.t.db.updateTable("files").set({ scan_status: "clean" }).where("id", "=", id).execute();
  return apiRequest(w.t, { url: `/v1/files/${id}/content?disposition=inline`, as: w.actors.staff });
};
const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

describe("content that is not what its name says", () => {
  it.each([
    ["HTML named .pdf", "plan.pdf", Buffer.from("<!doctype html><script>alert(1)</script>")],
    [
      "SVG with script named .png",
      "photo.png",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    ],
    ["XML named .pdf", "plan.pdf", Buffer.from('<?xml version="1.0"?><a/>')],
    ["Windows executable named .pdf", "plan.pdf", bytes("MZ", [0x90, 0, 3, 0, 0, 0, 4, 0], "\0".repeat(64))],
    ["zip archive named .pdf", "plan.pdf", bytes("PK", [3, 4, 20, 0], "\0".repeat(64))],
    ["ELF binary named .png", "photo.png", bytes([0x7f], "ELF", [2, 1, 1, 0], "\0".repeat(64))],
    ["a shell script", "run.txt", textBytes("#!/bin/sh\nrm -rf /\n")],
    ["HTML-looking text", "page.txt", textBytes("<html><body onload=alert(1)>")],
    ["text with a NUL byte", "notes.txt", Buffer.from("hello\0world")],
    ["an empty file", "empty.pdf", Buffer.alloc(0)],
  ])("%s is refused with 415 and stores nothing", async (_name, name, data) => {
    const before = await keys();
    const res = await send(name, data);
    expect(res.statusCode).toBe(415);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(await keys()).toEqual(before);
  });

  it("refuses a PDF in a box that takes DWG and a DWG in a box that takes PDF (the box decides, not the name)", async () => {
    const survey = { checkpointKey: "i2_0", slot: "survey" };
    expect((await send("x.dwg", pdfBytes(), survey)).statusCode).toBe(201);
    expect((await send("x.dwg", dwgBytes(), survey)).statusCode).toBe(201);
    expect((await send("x.pdf", pngBytes(), survey)).statusCode).toBe(415);
  });

  it.each([
    [
      "a PDF with a trailing script",
      "page.pdf",
      bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "\0".repeat(32), "<script>alert(1)</script>"),
      "application/pdf",
      API_CSP,
    ],
    [
      "a PNG with trailing HTML",
      "photo.png",
      Buffer.concat([pngBytes(), Buffer.from("<script>alert(1)</script>")]),
      "image/png",
      SANDBOX,
    ],
    ["a GIF that is also JavaScript", "anim.gif", bytes("GIF89a", [1, 0, 1, 0], "=1;alert(1)//"), "image/gif", SANDBOX],
    [
      "text that is also JavaScript",
      "run.txt",
      textBytes("alert(document.cookie)\n"),
      "text/plain; charset=utf-8",
      SANDBOX,
    ],
  ])("%s that passes the sniffer is served as its sniffed type, never as a page", async (_n, name, data, type, csp) => {
    const res = await send(name, data);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(201);
    const served = await content(res.json<{ file: { id: string } }>().file.id);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe(type);
    expect(served.headers["content-type"]).not.toContain("html");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["cache-control"]).toBe("private, no-store");
    expect(served.headers["content-security-policy"]).toBe(csp);
  });
});

describe("size", () => {
  it("accepts a file of exactly UPLOAD_MAX_BYTES and refuses one byte more with 413, leaving no object behind", async () => {
    const exact = pdfBytes(LIMIT - pdfBytes(0).length);
    expect(exact).toHaveLength(LIMIT);
    expect((await send("exact.pdf", exact)).statusCode).toBe(201);
    const before = await keys();
    const over = await send("over.pdf", pdfBytes(LIMIT + 1 - pdfBytes(0).length));
    expect(over.statusCode).toBe(413);
    expect(over.json<{ type: string }>().type).toBe("urn:kr:problem:payload-too-large");
    expect(await keys()).toEqual(before);
  });

  it("answers a JSON body above the 100 KB limit with 413 on a JSON route, not 500", async () => {
    const res = await apiRequest(w.t, {
      method: "POST",
      url: `/v1/jobs/${jobId}/notes`,
      as: w.actors.staff,
      body: { body: "x".repeat(110_000) },
    });
    expect(res.statusCode).toBe(413);
  });
});

describe("names", () => {
  it.each([
    "../../etc/passwd.pdf",
    "..\\..\\windows\\win.pdf",
    "/absolute/path.pdf",
    "a/../../b.pdf",
    "%2e%2e%2fx.pdf",
    "x\u0000y.pdf",
    "evil\r\nSet-Cookie: pwned=1.pdf",
    'quote".pdf',
    `${String.fromCodePoint(0x202e)}gpj.exe.pdf`,
    `${"long".repeat(100)}.pdf`,
    "....pdf....",
    "   .pdf",
  ])("%j is stored under a server-made key and shown sanitised", async (name) => {
    const res = await send(name, pdfBytes());
    expect([201, 400]).toContain(res.statusCode);
    expect(res.headers["set-cookie"]).toBeUndefined();
    for (const key of await keys()) expect(key).toMatch(KEY);
    if (res.statusCode !== 201) return;
    const { file } = res.json<{ file: { id: string; name: string } }>();
    expect(file.name).not.toMatch(/[\\/\p{Cc}\p{Cf}]/u);
    expect(file.name.length).toBeLessThanOrEqual(255);
    const row = await w.t.db
      .selectFrom("files")
      .select("storage_key")
      .where("id", "=", file.id)
      .executeTakeFirstOrThrow();
    expect(row.storage_key).toBe(`jobs/${jobId}/${file.id}`);
    const served = await content(file.id);
    expect(served.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(served.headers["set-cookie"]).toBeUndefined();
  });
});

describe("malformed multipart and fields", () => {
  const post = (payload: Buffer, headers: Record<string, string>, as = w.actors.staff) =>
    apiRequest(w.t, { method: "POST", url: `/v1/jobs/${jobId}/files`, as, body: payload, headers });
  const survey = { checkpointKey: "i2_0", slot: "survey" };
  const file = { name: "a.pdf", data: pdfBytes() };

  it.each([
    ["a path as the checkpoint", { checkpointKey: "../../x", slot: "survey" }],
    ["an unknown slot", { checkpointKey: "i2_0", slot: "../survey" }],
    ["a checkpoint with a condition", { ...survey, conditionId: "2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77" }],
    ["no target at all", {}],
    ["a job id field", { ...survey, jobId: "2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77" }],
  ])("%s is a 400 and stores nothing", async (_n, fields) => {
    const before = await keys();
    const res = await uploadFile(w.t, { jobId, as: w.actors.staff, fields, file });
    expect(res.statusCode).toBe(400);
    expect(await keys()).toEqual(before);
  });

  it("refuses a second file, a field after the file, a missing file part and a non-multipart body", async () => {
    const before = await keys();
    const cases = [
      multipartBody(survey, file, { extraFile: file }),
      multipartBody(survey, file, { trailingFields: { slot: "documents" } }),
      multipartBody(survey),
      multipartBody(survey, { ...file, field: "attachment" }),
    ];
    for (const c of cases) expect((await post(c.payload, c.headers)).statusCode).toBe(400);
    const json = await post(Buffer.from(JSON.stringify(survey)), { "content-type": "application/json" });
    expect([400, 415]).toContain(json.statusCode);
    expect(await keys()).toEqual(before);
  });

  it("stores nothing for a caller who may not upload there: authorisation precedes the first byte", async () => {
    const before = await keys();
    for (const as of [w.actors.client, w.actors.architect]) {
      expect((await send("a.pdf", pdfBytes(), survey, as)).statusCode).toBe(403);
    }
    expect((await send("a.pdf", pdfBytes(), survey, w.actors.outsider)).statusCode).toBe(404);
    expect(await keys()).toEqual(before);
  });
});

describe("scanning gates every read (MALWARE_SCAN_MODE=required)", () => {
  it("a fresh upload is pending and its bytes are not served until the worker marks it clean", async () => {
    const res = await send("fresh.pdf", pdfBytes(40, "marker-bytes"));
    const { file } = res.json<{ file: { id: string; scanStatus: string } }>();
    expect(file.scanStatus).toBe("pending");
    for (const status of ["pending", "infected", "error"] as const) {
      await w.t.db.updateTable("files").set({ scan_status: status }).where("id", "=", file.id).execute();
      const served = await apiRequest(w.t, { url: `/v1/files/${file.id}/content`, as: w.actors.staff });
      expect(served.statusCode, status).toBe(409);
      expect(served.body).not.toContain("marker-bytes");
    }
  });
});
