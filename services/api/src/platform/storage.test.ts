import type { ObjectStorage } from "@kr/storage";
import { describe, expect, it, vi } from "vitest";
import { testConfig } from "../../test/helpers/config.js";
import { S3_TIMEOUT_MS, createStorage, s3ConfigFrom } from "./storage.js";

describe("storage wiring", () => {
  it("maps ApiConfig to the S3 adapter config with the 10 s timeout (BE-10)", () => {
    expect(s3ConfigFrom(testConfig())).toEqual({
      endpoint: "http://localhost:9090",
      region: "auto",
      bucket: "tracker-files-test",
      accessKeyId: "fake-access-key",
      secretAccessKey: "fake-secret-access-key",
      forcePathStyle: true,
      timeoutMs: S3_TIMEOUT_MS,
    });
    expect(S3_TIMEOUT_MS).toBe(10_000);
  });
  it("builds the adapter through the injected factory", () => {
    const fake = {} as ObjectStorage;
    const factory = vi.fn(() => fake);
    expect(createStorage(testConfig(), factory)).toBe(fake);
    expect(factory).toHaveBeenCalledOnce();
  });
  it("defaults to the real S3 adapter factory", () => {
    const storage = createStorage(testConfig());
    expect(typeof storage.put).toBe("function");
    expect(typeof storage.ping).toBe("function");
  });
});
