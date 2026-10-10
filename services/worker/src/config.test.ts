import { ConfigError, parseConfig } from "@kr/config";
import { describe, expect, it } from "vitest";
import { WorkerConfigSchema } from "./config.js";

const valid = {
  APP_ENV: "staging",
  DATABASE_URL: "postgres://tracker_app:x@db:5432/tracker",
  S3_ENDPOINT: "https://storage.example.com",
  S3_BUCKET: "tracker-files",
  S3_ACCESS_KEY_ID: "fake",
  S3_SECRET_ACCESS_KEY: "fake-secret-key-123456",
};

describe("worker config", () => {
  it("defaults to the Sonnet model and scanning required", () => {
    const c = parseConfig(WorkerConfigSchema, valid);
    expect(c.ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(c.MALWARE_SCAN_MODE).toBe("required");
  });

  it("requires an API key when AI stamp reading is on", () => {
    expect(() => parseConfig(WorkerConfigSchema, { ...valid, FEATURE_AI_STAMP_READING: "true" })).toThrow(ConfigError);
  });

  it("refuses an upload limit larger than what clamd will stream", () => {
    expect(() => parseConfig(WorkerConfigSchema, { ...valid, UPLOAD_MAX_BYTES: String(80 * 1024 * 1024) })).toThrow(
      ConfigError,
    );
  });

  it("treats empty optional variables (a pasted .env.example) as unset", () => {
    const c = parseConfig(WorkerConfigSchema, {
      ...valid,
      ANTHROPIC_API_KEY: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_HEADERS: "",
    });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(c.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
  });

  it("an empty ANTHROPIC_API_KEY does not satisfy the AI stamp reading flag", () => {
    expect(() =>
      parseConfig(WorkerConfigSchema, { ...valid, FEATURE_AI_STAMP_READING: "true", ANTHROPIC_API_KEY: "" }),
    ).toThrow(ConfigError);
  });

  it("keeps required variables required when empty", () => {
    expect(() => parseConfig(WorkerConfigSchema, { ...valid, DATABASE_URL: "" })).toThrow(ConfigError);
  });

  it("fails closed when APP_ENV is missing in production (MALWARE_SCAN_MODE=disabled would be accepted)", () => {
    const { APP_ENV: _omit, ...rest } = valid;
    try {
      parseConfig(WorkerConfigSchema, { ...rest, MALWARE_SCAN_MODE: "disabled" });
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).variables).toContain("APP_ENV");
    }
    expect(parseConfig(WorkerConfigSchema, { ...rest, NODE_ENV: "development" }).APP_ENV).toBe("local");
  });
});
