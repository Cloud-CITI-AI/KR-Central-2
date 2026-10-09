import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BooleanFromString, ConfigError, CsvList, HttpsUrl, parseConfig, PostgresUrl } from "./index.js";

describe("config helpers", () => {
  const Schema = z.object({
    FLAG: BooleanFromString.default(false),
    LIST: CsvList.default([]),
    DB: PostgresUrl,
    PUBLIC_URL: HttpsUrl,
  });

  it("parses typed values", () => {
    const c = parseConfig(Schema, {
      FLAG: "false",
      LIST: "a, b,,c",
      DB: "postgres://x",
      PUBLIC_URL: "https://example.com",
    });
    expect(c).toEqual({ FLAG: false, LIST: ["a", "b", "c"], DB: "postgres://x", PUBLIC_URL: "https://example.com" });
    expect(parseConfig(Schema, { FLAG: "1", DB: "postgresql://x", PUBLIC_URL: "https://e.com" }).FLAG).toBe(true);
  });

  it("reports variable names only", () => {
    try {
      parseConfig(Schema, { DB: "mysql://secret-value", PUBLIC_URL: "http://insecure" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).variables).toEqual(["DB", "PUBLIC_URL"]);
      expect((e as Error).message).not.toContain("secret-value");
    }
  });
});
