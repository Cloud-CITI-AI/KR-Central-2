import { describe, expect, it } from "vitest";
import { contentUrl, opensInTab, viewFor } from "./content";
import { syntheticFile } from "./test-fixtures";

describe("contentUrl", () => {
  it("is the same-origin BFF path of getFileContent", () => {
    expect(contentUrl("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "/api/v1/files/0f8fad5b-d9cb-469f-a165-70867728950e/content",
    );
  });

  it("asks for a download when the disposition is attachment", () => {
    expect(contentUrl("abc", "attachment")).toBe("/api/v1/files/abc/content?disposition=attachment");
  });
});

describe("viewFor", () => {
  it.each([
    ["pending", "This file is still being checked for viruses."],
    ["infected", "Blocked – failed the virus scan"],
    ["error", "Couldn't be checked for viruses – remove it and upload it again"],
  ] as const)("a %s file shows its message whatever its kind", (scanStatus, message) => {
    const scanRetriesExhausted = scanStatus === "error";
    expect(viewFor(syntheticFile({ scanStatus, scanRetriesExhausted }))).toEqual({ type: "unavailable", message });
    expect(
      viewFor(syntheticFile({ scanStatus, scanRetriesExhausted, kind: "dwg", contentType: "image/vnd.dwg" })),
    ).toEqual({
      type: "unavailable",
      message,
    });
  });

  it("treats a failed scan that will be retried as still being checked, not lost", () => {
    expect(viewFor(syntheticFile({ scanStatus: "error", scanRetriesExhausted: false }))).toEqual({
      type: "unavailable",
      message: "This file is still being checked for viruses.",
    });
  });

  it.each(["clean", "skipped"] as const)("opens a %s file by its kind", (scanStatus) => {
    expect(viewFor(syntheticFile({ scanStatus }))).toEqual({ type: "pdf" });
    expect(viewFor(syntheticFile({ scanStatus, kind: "image", contentType: "image/png" }))).toEqual({ type: "image" });
    expect(viewFor(syntheticFile({ scanStatus, kind: "video", contentType: "video/mp4" }))).toEqual({ type: "video" });
    expect(viewFor(syntheticFile({ scanStatus, kind: "text", contentType: "text/plain" }))).toEqual({ type: "text" });
    expect(viewFor(syntheticFile({ scanStatus, kind: "dwg", contentType: "image/vnd.dwg" }))).toEqual({ type: "dwg" });
  });

  it("treats an email, and a pasted email stored as text, as an email, whatever its container", () => {
    const email = {
      parseStatus: "parsed",
      subject: "Query",
      from: null,
      to: null,
      cc: null,
      sentAt: null,
      isPasted: true,
      bodyText: null,
    } as const;
    expect(viewFor(syntheticFile({ kind: "email", contentType: "message/rfc822", email }))).toEqual({
      type: "email",
    });
    expect(viewFor(syntheticFile({ kind: "text", contentType: "text/plain", email }))).toEqual({
      type: "email",
    });
    expect(viewFor(syntheticFile({ kind: "email", contentType: "application/vnd.ms-outlook", email }))).toEqual({
      type: "email",
    });
  });
});

describe("opensInTab", () => {
  it("is true only for the kinds the server answers inline", () => {
    expect(["pdf", "image", "video", "text"].map((type) => opensInTab({ type } as never))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(opensInTab({ type: "dwg" })).toBe(false);
    expect(opensInTab({ type: "email" })).toBe(false);
    expect(opensInTab({ type: "unavailable", message: "x" })).toBe(false);
  });
});
