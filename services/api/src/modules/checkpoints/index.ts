/**
 * Checkpoint status, responsibility, KR note, client decisions and paid responses. Public entry of the `checkpoints`
 * module (WP-08). Audit action names: see README.md.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerCheckpointRoutes } from "./http/routes.js";

export const checkpointsModule: ApiModule = {
  name: "checkpoints",
  operations: ["updateCheckpoint", "recordDecision", "markPaid", "undoPaid"],
  register(app, deps) {
    registerCheckpointRoutes(app, deps);
  },
};
