/**
 * Module contract for services/api (ADR-0004). Each domain module lives in src/modules/<name>/ with
 * http/ (routes, request parsing, response mapping) → domain/ (pure rules, no I/O) → data/ (Kysely repositories),
 * and exposes ONLY src/modules/<name>/index.ts. Cross-module calls go through that index.
 * app.ts (WP-01) registers every module in MODULES; a route-table test checks that each registry operation is
 * registered by exactly the module that lists it in `operations`.
 * WP-01 may extend these types (e.g. typed Fastify instance with the zod type provider) but must keep them
 * backwards compatible with the module stubs.
 */
import type { OperationId } from "@kr/contracts";
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config.js";

/** Injected clock (TD-4). */
export interface Clock {
  now(): Date;
}

/** Feature flags (CF-4, OpenFeature-backed in WP-01). Owners/removal dates: docs/flags.md. */
export type FeatureFlag = "ai-stamp-reading" | "entra-guest-invites";

export interface FeatureFlags {
  isEnabled(flag: FeatureFlag): boolean;
}

export interface ModuleDeps {
  readonly db: Db;
  readonly config: ApiConfig;
  readonly clock: Clock;
  readonly storage: ObjectStorage;
  readonly flags: FeatureFlags;
  readonly log: Logger;
}

export interface ApiModule {
  readonly name: string;
  /** Registry operations this module registers (packages/contracts ROUTES). */
  readonly operations: readonly OperationId[];
  register(app: FastifyInstance, deps: ModuleDeps): Promise<void> | void;
}
