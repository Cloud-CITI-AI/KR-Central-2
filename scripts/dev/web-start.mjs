// `pnpm start` for the web app (apps/web runs `node ../../scripts/dev/web-start.mjs`): runs the standalone server that
// `next build` writes (output: "standalone"), exactly what the web image and infra/railway/services/web.json run.
// `next start` does not work with that output. The standalone folder does not contain `.next/static` and `public`, so
// they are copied next to server.js first, as apps/web/Dockerfile does. Build first: `pnpm --filter @kr/web build`.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

const web = new URL("../../apps/web/", import.meta.url);
const standalone = new URL(".next/standalone/apps/web/", web);
const server = new URL("server.js", standalone);
if (!existsSync(server)) {
  process.stderr.write(
    "apps/web/.next/standalone/apps/web/server.js not found: run `pnpm --filter @kr/web build` first\n",
  );
  process.exit(1);
}
cpSync(new URL(".next/static/", web), new URL(".next/static/", standalone), { recursive: true });
cpSync(new URL("public/", web), new URL("public/", standalone), { recursive: true });

const child = spawn(process.execPath, [server.pathname], { stdio: "inherit", env: { PORT: "3000", ...process.env } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
