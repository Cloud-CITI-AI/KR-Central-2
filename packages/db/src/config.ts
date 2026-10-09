/** Environment for the db CLIs (migrate, bootstrap). Parsed once; exits on invalid config (BE-2). */
import { z } from "zod";

const MigrateEnv = z.object({ MIGRATION_DATABASE_URL: z.string().min(1) });
const BootstrapEnv = z.object({
  SUPERUSER_DATABASE_URL: z.string().min(1),
  TRACKER_MIGRATOR_PASSWORD: z.string().min(16),
  TRACKER_APP_PASSWORD: z.string().min(16),
});

function parse<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const r = schema.safeParse(env);
  if (!r.success) {
    process.stderr.write(`Invalid configuration: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}\n`);
    process.exit(1);
  }
  return r.data;
}

export const loadMigrateEnv = (env: NodeJS.ProcessEnv = process.env) => parse(MigrateEnv, env);
export const loadBootstrapEnv = (env: NodeJS.ProcessEnv = process.env) => parse(BootstrapEnv, env);
