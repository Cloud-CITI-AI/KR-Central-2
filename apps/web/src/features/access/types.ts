import type { AccessGrant, AccessGrantPage } from "@kr/contracts";
import type { z } from "zod";

/** The contract exports the grant as a schema only. */
export type Grant = z.infer<typeof AccessGrant>;
export type GrantPage = z.infer<typeof AccessGrantPage>;
