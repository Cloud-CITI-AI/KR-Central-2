import { describe, expect, it } from "vitest";
import { contentUrl } from "./content";

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
