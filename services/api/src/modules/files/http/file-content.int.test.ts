import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, type SignedIn, type TestApp } from "../../../../test/helpers/index.js";
import { dwgBytes, emlBytes, pdfBytes, pngBytes, seedFile, textBytes } from "../testing.js";

const SANDBOX = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

describe("getFileContent (real Postgres, in-memory storage)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, staff: SignedIn, client: SignedIn, outsider: SignedIn;
  let jobId: string;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") => signIn(t, await f.makeUser({ role }));
  const content = (who: SignedIn | undefined, id: string, query = "") =>
    apiRequest(t, { url: `/v1/files/${id}/content${query}`, ...(who ? { as: who } : {}) });

  beforeAll(async () => {
    t = await createTestApp();
    f = createFactories(t.db);
    [admin, staff, client, outsider] = [
      await as("admin"),
      await as("staff"),
      await as("external"),
      await as("external"),
    ];
    jobId = (await f.makeJob()).id;
    await f.makeGrant({ jobId, userId: client.user.id, role: "client" });
  });
  afterAll(async () => {
    await t.close();
  });

  describe("scan gating (PRODUCT_SPEC 5.5, 11, 11.1)", () => {
    it.each([
      ["pending", "urn:kr:problem:file-not-ready", "This file is still being checked for viruses."],
      ["infected", "urn:kr:problem:file-rejected", "Blocked – failed the virus scan"],
      ["error", "urn:kr:problem:file-rejected", "Couldn't be checked for viruses – remove it and upload it again"],
    ] as const)("a %s file is a 409 problem with the spec message and no bytes", async (scanStatus, type, detail) => {
      const file = await seedFile(t, f, { jobId, data: pdfBytes(), scanStatus });
      const res = await content(staff, file.id);
      expect(res.statusCode).toBe(409);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toMatchObject({ type, status: 409, detail });
      expect(res.rawPayload.includes(pdfBytes().subarray(0, 8))).toBe(false);
    });

    it("serves clean files and files skipped by MALWARE_SCAN_MODE=disabled", async () => {
      for (const scanStatus of ["clean", "skipped"] as const) {
        const data = pdfBytes(100, scanStatus);
        const file = await seedFile(t, f, { jobId, data, scanStatus });
        const res = await content(client, file.id);
        expect(res.statusCode).toBe(200);
        expect(res.rawPayload).toEqual(data);
      }
    });
  });

  it("downloads a text file stored under a dangerous extension as .txt", async () => {
    const file = await seedFile(t, f, {
      jobId,
      data: textBytes("[InternetShortcut]\r\n"),
      name: "shortcut.url",
      kind: "text",
      contentType: "text/plain",
    });
    const res = await content(client, file.id, "?disposition=attachment");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="shortcut.url.txt"; filename*=UTF-8''shortcut.url.txt`,
    );
  });

  it.each([
    ["report.exe", "report.exe.pdf"],
    ["invoice.pdf.lnk", "invoice.pdf.lnk.pdf"],
    ["noext", "noext.pdf"],
  ])("downloads a PDF stored as %j under the name %j, inline or not", async (name, served) => {
    const file = await seedFile(t, f, { jobId, data: pdfBytes(300), name });
    for (const disposition of ["attachment", "inline"]) {
      const res = await content(client, file.id, `?disposition=${disposition}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toBe(
        `${disposition}; filename="${served}"; filename*=UTF-8''${served}`,
      );
    }
  });

  describe("headers (PRODUCT_SPEC 11)", () => {
    it("a PDF is inline, no-store, nosniff and sized, with an RFC 5987 file name and no sandbox CSP", async () => {
      const data = pdfBytes(500);
      const file = await seedFile(t, f, { jobId, data, name: "Survey – plan (1).pdf" });
      const res = await content(client, file.id);
      expect(res.statusCode).toBe(200);
      expect(res.headers).toMatchObject({
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="Survey _ plan (1).pdf"; filename*=UTF-8''Survey%20%E2%80%93%20plan%20%281%29.pdf`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "accept-ranges": "bytes",
        "content-length": String(data.length),
      });
      expect(res.headers["content-security-policy"]).not.toContain("sandbox");
    });

    it.each([
      ["image", pngBytes(), "image/png", "image/png", "inline"],
      ["text", textBytes("hello\n"), "text/csv", "text/plain; charset=utf-8", "inline"],
      ["dwg", dwgBytes(), "image/vnd.dwg", "image/vnd.dwg", "attachment"],
      ["email", emlBytes(), "message/rfc822", "message/rfc822", "attachment"],
    ] as const)("%s: %s served as %s, %s", async (kind, data, storedType, servedType, disposition) => {
      const file = await seedFile(t, f, { jobId, data, kind, contentType: storedType, name: `file.${kind}` });
      const res = await content(staff, file.id);
      expect(res.headers["content-type"]).toBe(servedType);
      expect(res.headers["content-disposition"]).toContain(`${disposition};`);
      expect(res.headers["content-security-policy"]).toBe(SANDBOX);
      expect(res.rawPayload).toEqual(data);
    });

    it("?disposition=attachment turns any file into a download", async () => {
      const file = await seedFile(t, f, { jobId, data: pdfBytes() });
      const res = await content(staff, file.id, "?disposition=attachment");
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect((await content(staff, file.id, "?disposition=nope")).statusCode).toBe(400);
    });
  });

  describe("authorisation", () => {
    it("404 for the fee proposal's files without fee_proposal.view, an invisible job, a removed or unknown file", async () => {
      const fee = await seedFile(t, f, { jobId, data: pdfBytes(), checkpointKey: "i1_0p", slot: "documents" });
      expect((await content(staff, fee.id)).statusCode).toBe(404);
      expect((await content(admin, fee.id)).statusCode).toBe(200);
      expect((await content(client, fee.id)).statusCode).toBe(200);
      const file = await seedFile(t, f, { jobId, data: pdfBytes() });
      expect((await content(outsider, file.id)).statusCode).toBe(404);
      await t.db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", file.id).execute();
      expect((await content(admin, file.id)).statusCode).toBe(404);
      expect((await content(admin, "4a1f0f3e-5b0d-4c1c-8f75-6a9c2d7d9e10")).statusCode).toBe(404);
      expect((await content(undefined, file.id)).statusCode).toBe(401);
    });

    it("a clean file whose object is gone is a 404 and an error in the log", async () => {
      const file = await seedFile(t, f, { jobId, data: pdfBytes() });
      await t.storage.delete(file.storage_key);
      expect((await content(staff, file.id)).statusCode).toBe(404);
      expect(t.logLines()).toContainEqual(expect.objectContaining({ event: "file_object_missing", fileId: file.id }));
    });
  });
});
