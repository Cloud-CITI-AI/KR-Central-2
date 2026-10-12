/**
 * The kr-clamav entrypoint wrapper sets clamd's bind address from CLAMD_TCP_ADDR (default `::`) and then execs the
 * upstream /init. No Docker needed: the config path and the init command are replaced through the script's test hooks.
 *
 *   node --test infra/clamav/test/entrypoint.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "kr-entrypoint.sh");
const shippedConf = readFileSync(join(here, "..", "clamd.conf"), "utf8");

let dir;
let fakeInit;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "kr-clamav-entry-"));
  fakeInit = join(dir, "init");
  writeFileSync(fakeInit, '#!/bin/sh\necho "init:$*"\n');
  chmodSync(fakeInit, 0o755);
});
after(() => rmSync(dir, { recursive: true, force: true }));

function run(env, conf = shippedConf, args = []) {
  const confPath = join(dir, "clamd.conf");
  writeFileSync(confPath, conf);
  const result = spawnSync("sh", [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, KR_CLAMD_CONF: confPath, KR_CLAMAV_INIT: fakeInit, ...env },
  });
  return { ...result, conf: readFileSync(confPath, "utf8") };
}

describe("kr-entrypoint.sh", () => {
  it("keeps `::` when CLAMD_TCP_ADDR is not set (Railway's IPv6 private network)", () => {
    const r = run({});
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.conf, /^TCPAddr ::$/m);
  });

  it("binds the address in CLAMD_TCP_ADDR (0.0.0.0 on an IPv4-only Docker host) and leaves the rest of the config alone", () => {
    const r = run({ CLAMD_TCP_ADDR: "0.0.0.0" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.conf, shippedConf.replace(/^TCPAddr ::$/m, "TCPAddr 0.0.0.0"));
    assert.equal(r.conf.match(/^TCPAddr /gm).length, 1, "exactly one TCPAddr line (clamd binds every one it finds)");
  });

  it("replaces a previously written address, so a restart with another value works", () => {
    const r = run({ CLAMD_TCP_ADDR: "::" }, shippedConf.replace(/^TCPAddr ::$/m, "TCPAddr 0.0.0.0"));
    assert.match(r.conf, /^TCPAddr ::$/m);
  });

  it("hands over to the upstream init with its arguments", () => {
    const r = run({}, shippedConf, ["--version"]);
    assert.equal(r.stdout.trim(), "init:--version");
  });

  it("refuses a value that is not an IP literal and never starts init", () => {
    for (const bad of ["a b", "0.0.0.0;rm", "|x|", "host.name!", "$(id)"]) {
      const r = run({ CLAMD_TCP_ADDR: bad });
      assert.equal(r.status, 64, `${JSON.stringify(bad)}: ${r.stderr}`);
    }
  });

  it("fails when the config has no TCPAddr line", () => {
    const r = run({}, "TCPSocket 3310\n");
    assert.equal(r.status, 70);
    assert.equal(r.stdout, "");
  });
});
