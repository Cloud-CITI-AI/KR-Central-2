import { fileURLToPath } from "node:url";

/** Synthetic Entra tenant and app registration for the mock IdP (never a real tenant: TD-1). */
export const TENANT_ID = "00000000-0000-4000-8000-0000000e2e01";
export const CLIENT_ID = "00000000-0000-4000-8000-0000000e2e02";
export const CLIENT_SECRET = "e2e-client-secret-not-secret";
export const STAFF_DOMAIN = "krsurveys.com.au";

/** Repository root and the built services the harness starts (`pnpm build` first). */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const WEB_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const API_ENTRY = `${REPO_ROOT}services/api/dist/main.js`;
export const WORKER_ENTRY = `${REPO_ROOT}services/worker/dist/main.js`;
export const CLAMD_CONF = `${REPO_ROOT}infra/clamav/clamd.conf`;

/** Where the main stack's web server listens; baseURL of every project (override with E2E_WEB_PORT). */
export const MAIN_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const MAIN_WEB_URL = `http://localhost:${MAIN_WEB_PORT}`;

/** The environment variable that carries the running main stack to the test workers (JSON of `StackInfo`). */
export const STACK_INFO_ENV = "E2E_STACK_INFO";
export const S3MOCK_IMAGE = "adobe/s3mock:latest";
export const CLAMAV_IMAGE = process.env.CLAMAV_IMAGE ?? "clamav/clamav:stable";
