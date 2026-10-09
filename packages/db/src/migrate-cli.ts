/** `node dist/migrate-cli.js` — Railway pre-deploy command (uses MIGRATION_DATABASE_URL as tracker_migrator). */
import { loadMigrateEnv } from "./config.js";
import { migrate } from "./migrate.js";

const env = loadMigrateEnv();
migrate({
  connectionString: env.MIGRATION_DATABASE_URL,
  log: (m) => process.stdout.write(`${JSON.stringify({ level: "info", event: "migration", message: m })}\n`),
})
  .then((applied) => {
    process.stdout.write(
      `${JSON.stringify({ level: "info", event: "migrations_complete", applied: applied.length })}\n`,
    );
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ level: "error", event: "migrations_failed", message: (err as Error).message })}\n`,
    );
    process.exit(1);
  });
