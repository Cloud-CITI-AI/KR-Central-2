/** Object storage wiring: the one place that maps ApiConfig to the @kr/storage adapter (BE-10: S3 timeout 10 s). */
import { createS3Storage, type ObjectStorage, type S3StorageConfig } from "@kr/storage";
import type { ApiConfig } from "../config.js";

export const S3_TIMEOUT_MS = 10_000;

export type StorageFactory = (cfg: S3StorageConfig) => ObjectStorage;

export function s3ConfigFrom(config: ApiConfig): S3StorageConfig {
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    timeoutMs: S3_TIMEOUT_MS,
  };
}

export function createStorage(config: ApiConfig, factory: StorageFactory = createS3Storage): ObjectStorage {
  return factory(s3ConfigFrom(config));
}
