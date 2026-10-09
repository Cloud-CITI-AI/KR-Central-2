/** `node dist/bootstrap-cli.js` — one-off role/schema bootstrap by an operator (see docs/runbooks/database.md). */
import { bootstrapDatabase } from "./bootstrap.js";
import { loadBootstrapEnv } from "./config.js";

const env = loadBootstrapEnv();
bootstrapDatabase({
  superuserUrl: env.SUPERUSER_DATABASE_URL,
  migratorPassword: env.TRACKER_MIGRATOR_PASSWORD,
  appPassword: env.TRACKER_APP_PASSWORD,
})
  .then(() => process.stdout.write("bootstrap complete\n"))
  .catch((err: unknown) => {
    process.stderr.write(`bootstrap failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
