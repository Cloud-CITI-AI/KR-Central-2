/** The handlers this worker runs, by operation type. Each PR of WP-12 adds its own entry here. */
import type { Db } from "@kr/db";
import type { ObjectStorage } from "@kr/storage";
import type { KrMetrics } from "@kr/telemetry";
import type { ClamdClient } from "../clients/clamd.js";
import type { WorkerConfig } from "../config.js";
import type { Parser } from "../parsing/isolate.js";
import type { Clock } from "../clock.js";
import type { StampReader } from "../clients/stamp-reader.js";
import type { FeatureFlags } from "../flags.js";
import { conditionsExtractHandler } from "./conditions-extract.js";
import { conformanceReadHandler } from "./conformance-read.js";
import { emailParseHandler } from "./email-parse.js";
import { fileScanHandler } from "./file-scan.js";
import { teamsCheckHandler } from "./teams-check.js";
import { teamsProvisionHandler } from "./teams-provision.js";
import { teamsPushHandler } from "./teams-push.js";
import { teamsPollHandler } from "./teams-poll.js";
import { teamsListChannelsHandler } from "./teams-list-channels.js";
import { teamsCreateChannelHandler } from "./teams-create-channel.js";
import type { GraphTeamsClient } from "../clients/graph-teams.js";
import type { GraphDriveClient } from "../clients/graph-drive.js";
import type { Handlers } from "./types.js";

export interface HandlerDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly clamd: ClamdClient;
  readonly parser: Parser;
  readonly clock: Clock;
  /** Feature flags resolved through OpenFeature at startup (CF-4). */
  readonly flags: FeatureFlags;
  /** Built by main only when the `ai-stamp-reading` flag is on and ANTHROPIC_API_KEY is set. */
  readonly stampReader?: StampReader | undefined;
  readonly config: WorkerConfig;
  readonly metrics: KrMetrics;
  /** Built by main only when the `teams-file-sync` flag is on (ADR-0015); the Teams handlers run as no-ops without it. */
  readonly graph?: GraphDriveClient | undefined;
  /** Phase 3 (E17): built with `graph` when the flag is on. */
  readonly teams?: GraphTeamsClient | undefined;
}

export function buildHandlers(deps: HandlerDeps): Handlers {
  return {
    "file.scan": fileScanHandler(deps),
    "email.parse": emailParseHandler(deps),
    "conditions.extract": conditionsExtractHandler(deps),
    "conformance.read": conformanceReadHandler(deps),
    "teams.check": teamsCheckHandler(deps),
    "teams.provision": teamsProvisionHandler(deps),
    "teams.push": teamsPushHandler(deps),
    "teams.poll": teamsPollHandler(deps),
    "teams.list_channels": teamsListChannelsHandler(deps),
    "teams.create_channel": teamsCreateChannelHandler(deps),
  };
}
