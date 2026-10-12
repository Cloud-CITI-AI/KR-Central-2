// `pnpm dev` for the web app (apps/web runs `node ../../scripts/dev/web.mjs`): loads the repository's root `.env` (the
// one README "Local development" creates; variables already in the environment win), then starts `next dev` on port 3000.
// Next itself only reads .env files inside apps/web, and `node --env-file` cannot be used because Next re-runs node
// with the flag copied into NODE_OPTIONS, where it is not allowed.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch (error) {
  if (error?.code !== "ENOENT") throw error; // no .env: start with the environment as it is
}

const next = createRequire(new URL("../../apps/web/package.json", import.meta.url)).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "--port", "3000"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
