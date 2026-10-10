import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppEnv,
  BooleanFromString,
  ConfigError,
  CsvList,
  HttpsUrl,
  isPlaceholderValue,
  NodeEnv,
  OptionalVar,
  parseConfig,
  PostgresUrl,
  refineNoPlaceholders,
} from "./index.js";

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

describe("OptionalVar", () => {
  const Schema = z.object({
    REQUIRED: z.string().min(1),
    ENDPOINT: OptionalVar(z.url()),
    TOKEN: OptionalVar(z.string().min(8)),
  });

  it("treats an unset or empty optional variable as undefined", () => {
    expect(parseConfig(Schema, { REQUIRED: "x" })).toEqual({ REQUIRED: "x" });
    const c = parseConfig(Schema, { REQUIRED: "x", ENDPOINT: "", TOKEN: "" });
    expect(c.ENDPOINT).toBeUndefined();
    expect(c.TOKEN).toBeUndefined();
  });

  it("still validates a value that is present", () => {
    expect(parseConfig(Schema, { REQUIRED: "x", ENDPOINT: "https://otel.example.com" }).ENDPOINT).toBe(
      "https://otel.example.com",
    );
    try {
      parseConfig(Schema, { REQUIRED: "x", ENDPOINT: "not a url", TOKEN: "short" });
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toEqual(["ENDPOINT", "TOKEN"]);
    }
  });

  it("keeps required variables required when empty", () => {
    try {
      parseConfig(Schema, { REQUIRED: "" });
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toEqual(["REQUIRED"]);
    }
  });
});

describe("explicit APP_ENV in production", () => {
  const Service = z.object({
    NODE_ENV: NodeEnv.default("production"),
    APP_ENV: AppEnv.default("local"),
  });

  it("refuses to start in production (the default NODE_ENV) without APP_ENV, naming it", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "production", APP_ENV: "" }]) {
      try {
        parseConfig(Service, env);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).variables).toEqual(["APP_ENV"]);
      }
    }
  });

  it("accepts any explicit APP_ENV in production, and still defaults to local outside production", () => {
    expect(parseConfig(Service, { APP_ENV: "staging" }).APP_ENV).toBe("staging");
    expect(parseConfig(Service, { NODE_ENV: "production", APP_ENV: "local" }).APP_ENV).toBe("local");
    expect(parseConfig(Service, { NODE_ENV: "development" }).APP_ENV).toBe("local");
    expect(parseConfig(Service, { NODE_ENV: "test" }).APP_ENV).toBe("local");
  });

  it("applies to a schema with refinements and leaves schemas without APP_ENV alone", () => {
    const refined = Service.refine(() => true);
    expect(() => parseConfig(refined, {})).toThrow(ConfigError);
    expect(parseConfig(z.object({ A: z.string().default("x") }), {})).toEqual({ A: "x" });
  });

  it("reports APP_ENV together with the other invalid variables", () => {
    const Both = Service.extend({ DB: PostgresUrl });
    try {
      parseConfig(Both, { DB: "mysql://x" });
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toEqual(["APP_ENV", "DB"]);
    }
  });
});

describe("placeholder values", () => {
  it("recognises .env.example placeholders, case-insensitively", () => {
    for (const v of [
      "fake-log-salt-change-me",
      "a-real-looking-thing-CHANGE-ME-later",
      "fake-secret-access-key",
      "FAKE-anything",
      "fake-client-secret-change-me",
      "postgres://tracker_app:local-app-password@db:5432/tracker",
      "postgres://tracker_migrator:local-migrator-password@localhost:5432/tracker",
    ])
      expect(isPlaceholderValue(v), v).toBe(true);
  });

  it("accepts a generated secret and a database URL with its own password", () => {
    for (const v of [
      "x7Qm2VtR9bLw0sKd4HfZpYc1",
      "a-fake-but-not-prefixed",
      "postgres://tracker_app:Zk3pQ9vL@db/tracker",
    ])
      expect(isPlaceholderValue(v), v).toBe(false);
  });

  const Schema = z
    .object({ APP_ENV: AppEnv, SECRET: z.string(), TOKEN: OptionalVar(z.string()) })
    .superRefine(refineNoPlaceholders(["SECRET", "TOKEN"]));

  it("refuses placeholders in staging and production only, naming the variables", () => {
    const env = { SECRET: "fake-x", TOKEN: "change-me" };
    for (const APP_ENV of ["staging", "production"]) {
      try {
        parseConfig(Schema, { ...env, APP_ENV });
        expect.unreachable();
      } catch (e) {
        expect((e as ConfigError).variables).toEqual(["SECRET", "TOKEN"]);
        expect((e as Error).message).not.toContain("fake-x");
      }
    }
    for (const APP_ENV of ["local", "preview"]) expect(parseConfig(Schema, { ...env, APP_ENV }).SECRET).toBe("fake-x");
    expect(parseConfig(Schema, { APP_ENV: "production", SECRET: "a1b2c3d4e5f6" }).SECRET).toBe("a1b2c3d4e5f6");
  });
});
