/**
 * Proves the ClamAV image (infra/clamav) can scan every accepted upload: a 55 MiB synthetic file scans clean, the EICAR
 * test string is detected, and a stream over StreamMaxLength (60M) is refused, so the limit in clamd.conf is the one in
 * force. Needs Docker; builds the image from this directory (or uses CLAMAV_IMAGE) and removes the container afterwards.
 *
 *   node --test infra/clamav/test/scan-limits.test.mjs
 *
 * Only Node built-ins (infra/ is not a pnpm workspace package). clamd takes 30-90 s to load its signatures.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const imageDir = join(here, "..");
const name = `kr-clamav-test-${process.pid}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

/** The EICAR antivirus test string, assembled at run time so this file is not itself flagged by scanners. */
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");

let port;

/** One clamd command over TCP; resolves with the reply text (null byte stripped). `source` yields INSTREAM chunks. */
function clamd(command, source) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const replies = [];
    socket.on("data", (chunk) => replies.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(replies).toString("utf8").replace(/\0$/, "")));
    socket.on("error", (error) => {
      // clamd drops the connection once a stream exceeds StreamMaxLength; whatever it answered is still the result.
      if (replies.length > 0) resolve(Buffer.concat(replies).toString("utf8").replace(/\0$/, ""));
      else reject(error);
    });
    socket.write(`z${command}\0`);
    if (!source) return;
    (async () => {
      for await (const data of source) {
        const size = Buffer.alloc(4);
        size.writeUInt32BE(data.length);
        if (!socket.write(Buffer.concat([size, data]))) await new Promise((r) => socket.once("drain", r));
      }
      socket.end(Buffer.alloc(4)); // zero-length chunk ends the stream
    })().catch(() => socket.destroy());
  });
}

async function* syntheticFile(bytes) {
  const block = randomBytes(MIB);
  for (let sent = 0; sent < bytes; sent += MIB) yield block.subarray(0, Math.min(MIB, bytes - sent));
}

before(async () => {
  const image = process.env.CLAMAV_IMAGE ?? "kr-clamav:test";
  if (!process.env.CLAMAV_IMAGE) docker("build", "-q", "-f", join(imageDir, "Dockerfile"), "-t", image, imageDir);
  // The image runs as shipped. Only the bind address changes when the host kernel has no IPv6 (CI runners and Railway
  // have it; some sandboxes do not, and clamd then refuses to bind `::`): CLAMD_TCP_ADDR, read by kr-entrypoint.sh.
  const addr = existsSync("/proc/net/if_inet6") ? [] : ["-e", "CLAMD_TCP_ADDR=0.0.0.0"];
  docker("run", "-d", "--name", name, "-p", "127.0.0.1::3310", ...addr, image);
  port = Number(docker("port", name, "3310/tcp").split(":").pop());
  const deadline = Date.now() + 240_000;
  for (;;) {
    const ready = await clamd("PING").catch(() => "");
    if (ready === "PONG") break;
    if (Date.now() > deadline) throw new Error(`clamd did not answer PING in time:\n${docker("logs", name)}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
});

after(() => {
  docker("rm", "-f", name);
});

describe("clamd in the kr-clamav image", () => {
  it("scans a 55 MiB synthetic file clean (more than the 25M older clamd defaults accept)", async () => {
    assert.equal(await clamd("INSTREAM", syntheticFile(55 * MIB)), "stream: OK");
  });

  it("detects the EICAR test string", async () => {
    const reply = await clamd("INSTREAM", [Buffer.from(EICAR)]);
    assert.match(reply, /^stream: .*EICAR.* FOUND$/i);
  });

  it("refuses a stream over StreamMaxLength (60M) instead of scanning part of it", async () => {
    const reply = await clamd("INSTREAM", syntheticFile(61 * MIB));
    assert.match(reply, /size limit/i);
    assert.match(reply, /ERROR$/);
  });
});
