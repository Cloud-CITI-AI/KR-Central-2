import * as CFB from "cfb";
import { describe, expect, it } from "vitest";
import { buildMsg, syntheticEmail, syntheticFaker } from "../../test/fixtures/builders.js";
import { DocumentParseError } from "../errors.js";
import { parseMsg } from "./msg.js";

const email = syntheticEmail(syntheticFaker(5));

describe("parseMsg (PRODUCT_SPEC §10.3)", () => {
  it.each([
    ["UTF-16 strings", {}],
    ["8-bit strings", { ansi: true }],
  ])("reads the headers and the plain body (%s)", (_name, options) => {
    const parsed = parseMsg(buildMsg(email, options));
    expect(parsed).toEqual({
      subject: email.subject,
      from: `${email.fromName} <${email.fromEmail}>`,
      to: email.to,
      cc: email.cc,
      date: "2026-03-16T01:30:00.000Z",
      body: email.body,
    });
  });

  it("falls back to the HTML body as text (no DOM, no scripts, no styles)", () => {
    const html =
      "<html><head><title>t</title><style>p{color:red}</style></head><body><h1>Hello</h1><p>First&nbsp;line<br>second &amp; third</p>" +
      '<script>alert(1)</script><ul><li>one</li><li>two</li></ul><a href="https://example.test/x">link</a></body></html>';
    const { body } = parseMsg(buildMsg(email, { html }));
    expect(body).toBe("Hello\n\nFirst line\nsecond & third\n\n * one\n * two\n\nlink");
  });

  it("uses the delivery time when there is no submit time, and no date when there is neither", () => {
    expect(parseMsg(buildMsg(email, { timeProperty: "delivery" })).date).toBe("2026-03-16T01:30:00.000Z");
    expect(parseMsg(buildMsg(email, { omitTime: true })).date).toBe("");
  });

  it("shows only the address when the sender has no distinct display name", () => {
    expect(parseMsg(buildMsg({ ...email, fromName: email.fromEmail })).from).toBe(email.fromEmail);
    expect(parseMsg(buildMsg({ ...email, fromName: "" })).from).toBe(email.fromEmail);
  });

  it("ignores streams inside attachment sub-storages", () => {
    const container = CFB.read(Buffer.from(buildMsg(email)), { type: "buffer" });
    CFB.utils.cfb_add(container, "/__attach_version1.0_#00000000/__substg1.0_0037001F", Buffer.from("x\0", "utf16le"));
    expect(parseMsg(Uint8Array.from(CFB.write(container, { type: "buffer" }) as Buffer)).subject).toBe(email.subject);
  });

  it.each([
    ["empty", new Uint8Array()],
    ["text", new TextEncoder().encode("Subject: not an msg")],
    ["truncated", buildMsg(email).subarray(0, 600)],
    [
      "a compound file that is not a message",
      Uint8Array.from(CFB.write(CFB.utils.cfb_new(), { type: "buffer" }) as Buffer),
    ],
  ])("rejects %s with invalid_msg", (_name, bytes) => {
    expect(() => parseMsg(bytes)).toThrow(DocumentParseError);
    expect(() => parseMsg(bytes)).toThrow(expect.objectContaining({ code: "invalid_msg" }));
  });
});
