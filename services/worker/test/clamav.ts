import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer } from "testcontainers";
import { createClamdClient } from "../src/clients/clamd.js";

export interface RealClamd {
  readonly host: string;
  readonly port: number;
  stop(): Promise<void>;
}

const CONF = fileURLToPath(new URL("../../../infra/clamav/clamd.conf", import.meta.url));

/** The EICAR antivirus test string, built at run time so no scanner flags this source file. */
export const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");

/**
 * The real clamd (clamav/clamav:stable, or CLAMAV_IMAGE) with the repository's infra/clamav/clamd.conf mounted as shipped.
 * Only the bind address changes on a host kernel without IPv6, where clamd refuses `::`. Resolves once clamd answers PING
 * (it takes 30 to 90 s to load its signatures).
 */
export async function startRealClamd(): Promise<RealClamd> {
  let conf = readFileSync(CONF, "utf8");
  if (!existsSync("/proc/net/if_inet6")) conf = conf.replace(/^TCPAddr ::$/m, "TCPAddr 0.0.0.0");
  const dir = mkdtempSync(join(tmpdir(), "kr-clamd-"));
  const file = join(dir, "clamd.conf");
  writeFileSync(file, conf);
  const container = await new GenericContainer(process.env.CLAMAV_IMAGE ?? "clamav/clamav:stable")
    .withExposedPorts(3310)
    .withBindMounts([{ source: file, target: "/etc/clamav/clamd.conf", mode: "ro" }])
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(3310);
  const probe = createClamdClient({ host, port, timeoutMs: 2000, maxBytes: 1024 });
  const deadline = Date.now() + 170_000;
  while (!(await probe.ping())) {
    if (Date.now() > deadline) {
      await container.stop();
      throw new Error("clamd did not answer PING in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return {
    host,
    port,
    stop: async () => {
      await container.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
