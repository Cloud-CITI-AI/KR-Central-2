/** Every API module, in registration order (ADR-0004). app.ts (WP-01) iterates this list. */
import type { ApiModule } from "../platform/module.js";
import { authModule } from "./auth/index.js";
import { usersModule } from "./users/index.js";
import { jobsModule } from "./jobs/index.js";
import { checkpointsModule } from "./checkpoints/index.js";
import { filesModule } from "./files/index.js";
import { conditionsModule } from "./conditions/index.js";
import { operationsModule } from "./operations/index.js";
import { notesModule } from "./notes/index.js";
import { accessModule } from "./access/index.js";
import { auditModule } from "./audit/index.js";

export const MODULES: readonly ApiModule[] = [
  authModule,
  usersModule,
  jobsModule,
  checkpointsModule,
  filesModule,
  conditionsModule,
  operationsModule,
  notesModule,
  accessModule,
  auditModule,
];
