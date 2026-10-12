#!/usr/bin/env node
/** Launches the mock Entra IdP for local development: `node dist/cli.js` (settings: config.ts). Never deployed. */
import { startMockIdp } from "./server.js";
import { loadLocalOptions } from "./config.js";

const options = loadLocalOptions();
const idp = await startMockIdp(options);
process.stdout.write(
  [
    `mock Entra IdP listening: set ENTRA_AUTHORITY_HOST=${idp.authorityHost} (issuer ${idp.issuer})`,
    `sign-in redirect: ${(options.redirectUris ?? []).join(", ")}`,
    "synthetic users (choose one on the sign-in page):",
    ...options.users.map((u) => `  ${u.name} <${u.email ?? u.preferredUsername}>${u.acct === 1 ? " (guest)" : ""}`),
    "",
  ].join("\n"),
);
const stop = (): void => {
  idp.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
