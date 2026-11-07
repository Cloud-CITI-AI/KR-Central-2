/**
 * Microsoft Graph Teams calls for phase 3 (ADR-0015 A5; railway.md E17: `Channel.ReadBasic.All`, `Channel.Create`).
 * Built on the same transport as the drive client (retries, breaker, metrics, no secrets in errors) by reusing it
 * through a tiny request seam, so there is one way to call Graph in the worker.
 */
import type { DriveItem, GraphDriveClient } from "./graph-drive.js";
import { GraphError } from "./graph-drive.js";

export interface GraphChannel {
  readonly id: string;
  readonly displayName: string;
  readonly membershipType: "standard" | "private" | "shared" | "unknown";
}

export interface GraphTeamsClient {
  /** Every channel of the team (all pages). */
  listChannels(teamId: string, signal: AbortSignal): Promise<GraphChannel[]>;
  /** Creates a standard channel; a name already in use is a GraphError 409 (`nameAlreadyExists` or `Conflict`). */
  createChannel(teamId: string, displayName: string, signal: AbortSignal): Promise<GraphChannel>;
  /**
   * The channel's Files folder, waiting while Teams creates it (it may not exist for some seconds after a channel
   * is created). Resolves once Graph answers; throws the last GraphError after `attempts`.
   */
  channelFilesFolder(teamId: string, channelId: string, attempts: number, signal: AbortSignal): Promise<DriveItem>;
}

interface RawChannel {
  id?: unknown;
  displayName?: unknown;
  membershipType?: unknown;
}

const MEMBERSHIP = new Set(["standard", "private", "shared"]);

function toChannel(raw: RawChannel): GraphChannel {
  const id = typeof raw.id === "string" ? raw.id : "";
  const displayName = typeof raw.displayName === "string" ? raw.displayName : "";
  if (!id || !displayName)
    throw new GraphError("Graph returned a channel without an id or a name.", 200, "malformed_channel");
  const membership =
    typeof raw.membershipType === "string" && MEMBERSHIP.has(raw.membershipType) ? raw.membershipType : "unknown";
  return { id, displayName: displayName.slice(0, 50), membershipType: membership as GraphChannel["membershipType"] };
}

/** The request seam every Graph client shares (exposed by createGraphDriveClient as `request`). */
export type GraphRequest = GraphDriveClient["request"];

export function createGraphTeamsClient(
  request: GraphRequest,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): GraphTeamsClient {
  return {
    async listChannels(teamId, signal) {
      const out: GraphChannel[] = [];
      let target: string | null = `/teams/${encodeURIComponent(teamId)}/channels`;
      while (target !== null) {
        const body: { value?: unknown; "@odata.nextLink"?: unknown } = await request({ method: "GET", target }, signal);
        if (!Array.isArray(body.value)) throw new GraphError("Graph returned no channel list.", 200, "malformed_list");
        for (const raw of body.value as RawChannel[]) out.push(toChannel(raw));
        target = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
      }
      return out;
    },
    async createChannel(teamId, displayName, signal) {
      const body = await request<RawChannel>(
        {
          method: "POST",
          target: `/teams/${encodeURIComponent(teamId)}/channels`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName, membershipType: "standard" }),
        },
        signal,
      );
      return toChannel(body);
    },
    async channelFilesFolder(teamId, channelId, attempts, signal) {
      let last: unknown;
      for (let i = 0; i < attempts; i += 1) {
        try {
          return await request<DriveItem>(
            {
              method: "GET",
              target: `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/filesFolder`,
              item: true,
            },
            signal,
          );
        } catch (error) {
          last = error;
          if (!(error instanceof GraphError && (error.status === 404 || error.status === 400))) throw error;
          await sleep(Math.min(10_000, 1000 * 2 ** i), signal);
        }
      }
      throw last instanceof Error ? last : new GraphError("The channel's folder did not appear.", 404, "itemNotFound");
    },
  };
}
