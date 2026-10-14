import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { startTestDatabase, type TestDatabase } from "@kr/db/testing";
import { startMockIdp, type MockIdp, type MockUser } from "@kr/mock-idp";
import {
  API_ENTRY,
  CLAMAV_IMAGE,
  CLAMD_CONF,
  CLIENT_ID,
  CLIENT_SECRET,
  REPO_ROOT,
  S3MOCK_IMAGE,
  TENANT_ID,
  WEB_DIR,
  WORKER_ENTRY,
} from "./constants";
import { startFakeAnthropic } from "./fake-anthropic";
import {
  freePort,
  reapAbandonedRuns,
  RunScope,
  spawnService,
  startContainer,
  waitForHttp,
  type ManagedProcess,
} from "./lifecycle";
import { newSyntheticUser, BASE_USERS, type UserKind } from "./users";

/**
 * The synthetic stack: Postgres 17 (Testcontainers, migrated), the mock Entra IdP, an S3 mock, the API and the worker
 * from `dist`, and `next start` pointing at the API. Reusable: WP-22 (k6 smoke, web vitals) starts it with `startStack`.
 */

export type MalwareScanning = "disabled" | "clamav";

export interface StackOptions {
  /** Names the log directory and the bucket. */
  readonly label: string;
  /** `disabled` (files are marked skipped) or the real ClamAV container with the repository's clamd.conf. */
  readonly malwareScanning?: MalwareScanning;
  /** Fixed web port (the main stack uses the playwright baseURL's); default: any free port. */
  readonly webPort?: number;
  /** Directory for service logs (default test-results/stack-logs/<label> under the web app). */
  readonly logDir?: string;
  /** Users the IdP knows at start. Default: the base synthetic users. */
  readonly users?: readonly MockUser[];
  /** Also serve the small control endpoint that lets test workers add IdP users (needed by the main stack). */
  readonly control?: boolean;
}

/** The JSON-serialisable description of a running stack, passed to test workers in an environment variable. */
export interface StackInfo {
  readonly label: string;
  readonly webUrl: string;
  readonly apiUrl: string;
  readonly idpUrl: string;
  /** `POST {controlUrl}/users` with a MockUser adds an IdP user. */
  readonly controlUrl: string;
  readonly databaseUrl: string;
  readonly malwareScanning: MalwareScanning;
  readonly logDir: string;
}

export interface Stack {
  readonly info: StackInfo;
  readonly idp: MockIdp;
  addUser(kind: UserKind, label: string): MockUser;
  stop(): Promise<void>;
}

const APP_ENV = "local";

function s3Env(endpoint: string, bucket: string): Record<string, string> {
  return {
    S3_ENDPOINT: endpoint,
    S3_REGION: "us-east-1",
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: "e2e-access-key",
    S3_SECRET_ACCESS_KEY: "e2e-secret-access-key",
    S3_FORCE_PATH_STYLE: "true",
  };
}

/** A tiny HTTP endpoint inside the runner process: test workers cannot reach the in-process mock IdP otherwise. */
async function startControl(idp: MockIdp): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/users") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        idp.addUser(JSON.parse(Buffer.concat(chunks).toString("utf8")) as MockUser);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port.toString()}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

function startClamd(scope: RunScope): { host: string; port: number } {
  let conf = readFileSync(CLAMD_CONF, "utf8");
  // Docker's default bridge network has no IPv6 (even when the host does, as on CI runners), and clamd then refuses `::`.
  conf = conf.replace(/^TCPAddr ::$/m, "TCPAddr 0.0.0.0");
  const dir = mkdtempSync(join(tmpdir(), "kr-e2e-clamd-"));
  const file = join(dir, "clamd.conf");
  writeFileSync(file, conf);
  scope.onStop("remove clamd conf", () => {
    rmSync(dir, { recursive: true, force: true });
  });
  const container = startContainer(scope, {
    image: CLAMAV_IMAGE,
    containerPort: 3310,
    mounts: [{ source: file, target: "/etc/clamav/clamd.conf" }],
  });
  return { host: container.host, port: container.port };
}

/** clamd answers PING only after loading its signatures (30 to 90 s). */
async function waitForClamd(host: string, port: number, timeoutMs: number): Promise<void> {
  const { createConnection } = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const answer = await new Promise<string>((resolve) => {
      const socket = createConnection({ host, port });
      let data = "";
      socket.setTimeout(3000, () => {
        socket.destroy();
      });
      socket.on("connect", () => socket.write("zPING\0"));
      socket.on("data", (chunk) => {
        data += chunk.toString("utf8");
      });
      socket.on("close", () => {
        resolve(data);
      });
      socket.on("error", () => {
        resolve("");
      });
    });
    if (answer.startsWith("PONG")) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("clamd did not answer PING in time");
}

export async function startStack(options: StackOptions): Promise<Stack> {
  reapAbandonedRuns();
  const scope = new RunScope();
  const scanning = options.malwareScanning ?? "disabled";
  const logDir = options.logDir ?? join(WEB_DIR, "test-results", "stack-logs", options.label);
  mkdirSync(logDir, { recursive: true });
  try {
    const database: TestDatabase = await startTestDatabase();
    scope.onStop("stop postgres", () => database.stop());

    const bucket = `kr-e2e-${options.label.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 60);
    const s3 = startContainer(scope, {
      image: S3MOCK_IMAGE,
      containerPort: 9090,
      env: { COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: bucket },
    });
    const s3Endpoint = `http://${s3.host}:${s3.port.toString()}`;

    const anthropic = await startFakeAnthropic();
    scope.onStop("stop fake anthropic", () => anthropic.stop());

    const clamd = scanning === "clamav" ? startClamd(scope) : undefined;

    const webPort = options.webPort ?? (await freePort());
    const webUrl = `http://localhost:${webPort.toString()}`;
    const apiPort = await freePort();
    const apiUrl = `http://127.0.0.1:${apiPort.toString()}`;

    const idp = await startMockIdp({
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      users: options.users ?? BASE_USERS,
      redirectUris: [`${webUrl}/api/v1/auth/callback`],
      postLogoutRedirectUris: [`${webUrl}/signed-out`],
    });
    scope.onStop("stop mock idp", () => idp.stop());
    const control = options.control ? await startControl(idp) : undefined;
    if (control) scope.onStop("stop control endpoint", control.close);

    const shared = {
      NODE_ENV: "production",
      APP_ENV,
      LOG_LEVEL: "info",
      DATABASE_URL: database.appUrl,
      MALWARE_SCAN_MODE: scanning === "clamav" ? "required" : "disabled",
      FEATURE_AI_STAMP_READING: "true",
      ...s3Env(s3Endpoint, bucket),
    };

    const api = spawnService(scope, {
      name: "api",
      command: process.execPath,
      args: [API_ENTRY],
      cwd: REPO_ROOT,
      logDir,
      env: {
        ...shared,
        PORT: apiPort.toString(),
        HOST: "127.0.0.1",
        TRUST_PROXY_HOPS: "1",
        PUBLIC_BASE_URL: webUrl,
        ENTRA_TENANT_ID: TENANT_ID,
        ENTRA_CLIENT_ID: CLIENT_ID,
        ENTRA_CLIENT_SECRET: CLIENT_SECRET,
        ENTRA_AUTHORITY_HOST: idp.authorityHost,
        LOG_PSEUDONYM_SALT: "e2e-log-salt-not-secret",
        REQUIRE_MFA_FOR_ADMIN: "true",
        // Parallel journeys share one IP and a few users: lift the limits (the limits themselves are tested in the API).
        RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: "5000",
        RATE_LIMIT_WRITES_PER_MINUTE: "5000",
        RATE_LIMIT_UPLOADS_PER_MINUTE: "5000",
        RATE_LIMIT_READS_PER_MINUTE: "20000",
      },
    });
    const workerHealthPort = await freePort();
    const worker: ManagedProcess = spawnService(scope, {
      name: "worker",
      command: process.execPath,
      args: [WORKER_ENTRY],
      cwd: REPO_ROOT,
      logDir,
      env: {
        ...shared,
        PORT: workerHealthPort.toString(),
        HOST: "127.0.0.1",
        WORKER_POLL_INTERVAL_MS: "200",
        ANTHROPIC_API_KEY: "e2e-fake-key-never-used",
        ANTHROPIC_BASE_URL: anthropic.baseUrl,
        ...(clamd ? { CLAMAV_HOST: clamd.host, CLAMAV_PORT: clamd.port.toString() } : {}),
      },
    });
    const nextBin = createRequire(`${WEB_DIR}package.json`).resolve("next/dist/bin/next");
    const web = spawnService(scope, {
      name: "web",
      command: process.execPath,
      args: [nextBin, "start", "--port", webPort.toString()],
      cwd: WEB_DIR,
      logDir,
      env: { API_INTERNAL_URL: apiUrl, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", PORT: webPort.toString() },
    });

    if (clamd) await waitForClamd(clamd.host, clamd.port, 170_000);
    await Promise.all([
      waitForHttp(`${apiUrl}/readyz`, { process: api }),
      waitForHttp(`http://127.0.0.1:${workerHealthPort.toString()}/readyz`, { process: worker }),
      waitForHttp(`${webUrl}/api/healthz`, { process: web }),
    ]);

    const info: StackInfo = {
      label: options.label,
      webUrl,
      apiUrl,
      idpUrl: idp.authorityHost,
      controlUrl: control?.url ?? "",
      databaseUrl: database.appUrl,
      malwareScanning: scanning,
      logDir,
    };
    return {
      info,
      idp,
      addUser(kind, label) {
        const user = newSyntheticUser(kind, label);
        idp.addUser(user);
        return user;
      },
      stop: () => scope.stop(),
    };
  } catch (error) {
    await scope.stop().catch(() => undefined);
    throw error;
  }
}
