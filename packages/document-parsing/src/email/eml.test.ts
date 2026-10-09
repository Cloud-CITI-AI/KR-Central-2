import { describe, expect, it } from "vitest";
import { buildEml, buildMsg, syntheticEmail, syntheticFaker } from "../../test/fixtures/builders.js";
import { DocumentParseError } from "../errors.js";
import { parseEml } from "./eml.js";

const bytes = (lines: readonly string[]): Uint8Array => Buffer.from(lines.join("\r\n"), "latin1");
const b64 = (text: string, encoding: BufferEncoding = "utf8"): string => Buffer.from(text, encoding).toString("base64");
const parse = (lines: readonly string[]) => parseEml(bytes(lines));

describe("parseEml headers", () => {
  it("reads the headers and the plain body of a simple message", () => {
    expect(
      parse([
        "From: Sam Example <sam@example.test>",
        "To: a@example.test, b@example.test",
        "Cc: c@example.test",
        "Subject: Lot 12 plan",
        "Date: Mon, 16 Mar 2026 09:30:00 +0800 (AWST)",
        "",
        "  Hello,",
        "second line  ",
      ]),
    ).toEqual({
      subject: "Lot 12 plan",
      from: "Sam Example <sam@example.test>",
      to: "a@example.test, b@example.test",
      cc: "c@example.test",
      date: "2026-03-16T01:30:00.000Z",
      body: "Hello,\r\nsecond line",
    });
  });

  it("unfolds folded headers and keeps the first of a repeated header", () => {
    const parsed = parse(["Subject: one", "  two", "\tthree", "Subject: ignored", "From: a@example.test", "", "x"]);
    expect(parsed.subject).toBe("one two three");
  });

  it("returns empty fields and no date for missing or unparseable headers", () => {
    expect(parse(["Subject: s", "Date: not a date", "", "body"])).toMatchObject({ from: "", to: "", cc: "", date: "" });
    expect(parse(["Subject: s"])).toMatchObject({ body: "", date: "" });
  });

  it.each([
    ["base64 UTF-8", "=?UTF-8?B?" + b64("Café Müller") + "?=", "Café Müller"],
    ["Q iso-8859-1 with _ and =XX", "=?iso-8859-1?Q?Caf=E9_M=FCller?=", "Café Müller"],
    ["lower-case encoding letter", "=?utf-8?q?Caf=C3=A9?=", "Café"],
    ["language tag (RFC 2231)", "=?UTF-8*en?Q?Hi?=", "Hi"],
    ["text around a word", "Re: =?UTF-8?Q?Caf=C3=A9?= (plan)", "Re: Café (plan)"],
    ["whitespace between adjacent words is dropped", "=?UTF-8?Q?Hello?= =?UTF-8?Q?_World?=", "Hello World"],
    [
      "a character split across two words",
      `=?UTF-8?B?${b64("é").slice(0, 2)}==?= =?UTF-8?B?${b64(Buffer.from([0xa9]).toString("latin1"), "latin1")}?=`,
      "é",
    ],
    ["unknown charset falls back to UTF-8", "=?x-unknown?Q?Caf=C3=A9?=", "Café"],
    ["two charsets", "=?UTF-8?Q?a?= =?iso-8859-1?Q?=E9?=", "aé"],
    ["raw UTF-8 bytes", Buffer.from("Café", "utf8").toString("latin1"), "Café"],
    ["raw latin1 bytes that are not UTF-8", "Caf\xe9", "Caf\xe9"],
  ])("decodes %s in a Subject", (_name, header, expected) => {
    expect(parse([`Subject: ${header}`, "", "x"]).subject).toBe(expected);
  });
});

describe("parseEml bodies", () => {
  const plain = ["Content-Type: text/plain; charset=utf-8", "", "PLAIN"];
  const html = ["Content-Type: text/html; charset=utf-8", "", "<p>HTML <b>part</b></p>"];

  it.each([
    ["7bit", [], "Plain text", "Plain text"],
    ["base64", ["Content-Transfer-Encoding: base64"], b64("Café\nline two"), "Café\nline two"],
    [
      "quoted-printable utf-8",
      ["Content-Transfer-Encoding: quoted-printable"],
      "Caf=C3=A9 and a long=\r\n line",
      "Café and a long line",
    ],
  ])("decodes a %s single-part body", (_name, extra, body, expected) => {
    expect(parse(["Subject: s", "Content-Type: text/plain; charset=utf-8", ...extra, "", body]).body).toBe(expected);
  });

  it("applies the declared charset and falls back to UTF-8 for an unknown one", () => {
    const latin = (charset: string) =>
      parse([
        "Subject: s",
        `Content-Type: text/plain; charset="${charset}"`,
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Caf=E9",
      ]).body;
    expect(latin("iso-8859-1")).toBe("Café");
    expect(latin("windows-1252")).toBe("Café");
    expect(latin("x-nonsense")).toBe("Caf�");
  });

  it("converts an HTML-only message to text", () => {
    expect(parse(["Subject: s", ...html]).body).toBe("HTML part");
  });

  it("prefers text/plain in multipart/alternative, in either order", () => {
    for (const parts of [
      [plain, html],
      [html, plain],
    ]) {
      const lines = ["Subject: s", 'Content-Type: multipart/alternative; boundary="X"', ""];
      for (const part of parts) lines.push("--X", ...part);
      lines.push("--X--", "epilogue");
      expect(parse(lines).body).toBe("PLAIN");
    }
  });

  it("finds the text inside nested multipart/mixed and skips attachments and non-text parts", () => {
    const lines = [
      "Subject: s",
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "preamble is ignored",
      "--outer",
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"',
      "",
      "ATTACHED NOTES",
      "--outer",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "",
      "iVBORw0KGgo=",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      ...html,
      "--inner--",
      "--outer--",
    ];
    expect(parse(lines).body).toBe("HTML part");
  });

  it("returns an empty body for a multipart without a boundary or without text", () => {
    expect(parse(["Subject: s", "Content-Type: multipart/mixed", "", "--x", "text"]).body).toBe("");
    expect(parse(["Subject: s", "Content-Type: image/png", "", "abc"]).body).toBe("");
  });

  it("stops at the nesting limit instead of recursing without bound", () => {
    const lines = ["Subject: s", 'Content-Type: multipart/mixed; boundary="b0"', ""];
    for (let i = 0; i < 50; i += 1) lines.push(`--b${i}`, `Content-Type: multipart/mixed; boundary="b${i + 1}"`, "");
    lines.push("--b50", ...plain);
    expect(parse(lines).body).toBe("");
  });

  it("reads a generated message with RFC 2047 names and a base64 plain part", () => {
    const email = syntheticEmail(syntheticFaker(9));
    expect(parseEml(Buffer.from(buildEml(email)))).toEqual({
      subject: email.subject,
      from: `${email.fromName} <${email.fromEmail}>`,
      to: email.to,
      cc: email.cc,
      date: email.sentAt,
      body: email.body,
    });
  });
});

describe("parseEml malformed input", () => {
  it.each([
    ["empty", new Uint8Array()],
    ["blank lines", bytes(["", "", ""])],
    ["plain prose", bytes(["this is not an e-mail"])],
    ["binary", Uint8Array.from({ length: 256 }, (_v, i) => i)],
    ["an Outlook message", buildMsg(syntheticEmail())],
  ])("rejects %s with invalid_eml", (_name, input) => {
    expect(() => parseEml(input)).toThrow(DocumentParseError);
    expect(() => parseEml(input)).toThrow(expect.objectContaining({ code: "invalid_eml" }));
  });

  it.each([
    ["a base64 word of 800 KB", `=?utf-8?B?${Buffer.alloc(600_000, 0x41).toString("base64")}?=`],
    ["a Q word of 300k escapes", `=?utf-8?Q?${"=41".repeat(300_000)}?=`],
  ])("survives %s in a header (no stack overflow)", (_name, word) => {
    const parsed = parseEml(Buffer.from(`From: a@example.com\r\nSubject: ${word}\r\n\r\nbody`));
    expect(parsed.subject.length).toBeGreaterThan(100_000);
    expect(parsed.subject.startsWith("AAAA")).toBe(true);
  });

  it("never throws anything but DocumentParseError on mutated messages (seeded fuzz)", () => {
    const f = syntheticFaker(2026);
    const seed = Buffer.from(buildEml(syntheticEmail(f)));
    for (let n = 0; n < 300; n += 1) {
      const mutated = Buffer.from(seed.subarray(0, f.number.int({ min: 0, max: seed.length })));
      for (let k = 0; k < f.number.int({ min: 0, max: 8 }); k += 1) {
        if (mutated.length > 0) mutated[f.number.int({ max: mutated.length - 1 })] = f.number.int({ max: 255 });
      }
      try {
        const parsed = parseEml(mutated);
        expect(
          [parsed.subject, parsed.from, parsed.to, parsed.cc, parsed.date, parsed.body].every(
            (v) => typeof v === "string",
          ),
        ).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentParseError);
      }
    }
  });
});
