import { describe, expect, it } from "vitest";
import { LIMITS, toEmailFields } from "./email-fields.js";

const base = {
  subject: "Query",
  from: "A <a@example.test>",
  to: "b@example.test",
  cc: "",
  date: "2026-03-16T01:30:00.000Z",
  body: "Hello",
};

describe("toEmailFields", () => {
  it("keeps real values and turns empty ones into null (the subject becomes '(no subject)')", () => {
    expect(toEmailFields(base)).toEqual({
      subject: "Query",
      from_text: "A <a@example.test>",
      to_text: "b@example.test",
      cc_text: null,
      sent_at: new Date("2026-03-16T01:30:00.000Z"),
      body_text: "Hello",
    });
    expect(toEmailFields({ ...base, subject: "  ", body: "\n" })).toMatchObject({
      subject: "(no subject)",
      body_text: null,
    });
  });

  it("strips NUL characters, which Postgres text cannot store", () => {
    expect(toEmailFields({ ...base, subject: "a\0b", body: "\0\0" })).toMatchObject({ subject: "ab", body_text: null });
  });

  it("cuts every field to its column limit and never leaves half a surrogate pair", () => {
    const long = toEmailFields({
      ...base,
      subject: "s".repeat(2000),
      to: "t".repeat(9000),
      cc: "c".repeat(9000),
      body: "b".repeat(600_000),
    });
    expect([long.subject.length, long.to_text?.length, long.cc_text?.length, long.body_text?.length]).toEqual([
      LIMITS.subject,
      LIMITS.to,
      LIMITS.cc,
      LIMITS.body,
    ]);
    const emoji = toEmailFields({ ...base, subject: `${"x".repeat(LIMITS.subject - 1)}😀` });
    expect(emoji.subject).toBe("x".repeat(LIMITS.subject - 1));
  });

  it("accepts a plausible sent time only", () => {
    expect(toEmailFields({ ...base, date: "" }).sent_at).toBeNull();
    expect(toEmailFields({ ...base, date: "not a date" }).sent_at).toBeNull();
    expect(toEmailFields({ ...base, date: "1970-01-01T00:00:00Z" }).sent_at).toBeNull();
    expect(toEmailFields({ ...base, date: "2300-01-01T00:00:00Z" }).sent_at).toBeNull();
  });
});
