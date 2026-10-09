/** Test-only routes outside the contract: authenticated by the platform like every non-public route (deny by default). */
import type { ApiModule } from "../../src/platform/module.js";

export const probeModule: ApiModule = {
  name: "probe",
  operations: [],
  register(app) {
    app.get("/test/whoami", (req) => ({ userId: req.auth?.user.id ?? null, role: req.auth?.user.role ?? null }));
    app.post("/test/echo", (req) => ({ ok: true, userId: req.auth?.user.id ?? null }));
  },
};
