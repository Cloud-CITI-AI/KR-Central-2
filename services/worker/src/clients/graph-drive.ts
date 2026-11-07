/**
 * Microsoft Graph drive calls for the Teams integration (ADR-0015 decisions 4, 6, 8 and 9; X7 hosts approved in WP-25).
 * Plain fetch with an application token, one timeout per call, `Retry-After` honoured on 429/503/504 with bounded
 * jittered retries, a token refresh on 401, a circuit breaker on the service being down, and one metric per request
 * by status class. Errors carry the HTTP status and Graph's error code only: never a body, a path, an id or a URL.
 * Upload-session URLs are pre-authorised by Graph and get no Authorization header; they are never logged.
 */
import type { KrMetrics } from "@kr/telemetry";
import { systemClock, type Clock } from "../clock.js";
import { CircuitOpenError, createCircuitBreaker, type BreakerTuning } from "./circuit-breaker.js";
import { GraphTokenError, readErrorCode, type GraphTokenSource } from "./graph-token.js";

export const GRAPH_USER_AGENT_PREFIX = "NONISV|KRSurveys|KRTracker";
/** Simple PUT uploads are allowed up to 4 MiB; larger files use an upload session (decision 9). */
export const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Upload-session chunks: a multiple of 320 KiB, 10 MiB as decided. */
export const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;
const MAX_RETRIES = 3;
/** The longest a `Retry-After` is honoured before the operation gives up for this run (the sweep retries later). */
const MAX_RETRY_WAIT_MS = 60_000;
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_COOL_DOWN_MS = 30_000;

export class GraphError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  /** Milliseconds Graph asked us to wait (429/503/504), when it said. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    status: number | null,
    code: string | null,
    options: { retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GraphError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  /** The dependency is down, throttled or unreachable (retry later), not a reply about our request. */
  get unavailable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500;
  }
  /** Short code for operations.error_code and the panel: `permission_denied`, `graph_unavailable`, `not_found`, … */
  get kind(): "permission_denied" | "not_found" | "conflict" | "graph_unavailable" | "graph_error" {
    if (this.status === 401 || this.status === 403) return "permission_denied";
    if (this.status === 404) return "not_found";
    if (this.status === 409) return "conflict";
    if (this.unavailable) return "graph_unavailable";
    return "graph_error";
  }
  /** `403 accessDenied`: what the settings page shows for a failed check. */
  get display(): string {
    return `${this.status ?? "network"}${this.code ? ` ${this.code}` : ""}`;
  }
}

export interface DriveItem {
  readonly id: string;
  readonly name: string;
  readonly eTag: string | null;
  readonly size: number | null;
  readonly isFolder: boolean;
  readonly webUrl: string | null;
  /** `createdBy.application.id`: which app registration created the item (decision 8). */
  readonly createdByAppId: string | null;
  readonly parentId: string | null;
  /** The parent's path under the drive root as Graph reports it (`/a/b`, `` for the root), null when unknown. */
  readonly parentPath: string | null;
}

export interface GraphSite {
  readonly id: string;
  readonly webUrl: string;
  readonly displayName: string | null;
}

export interface GraphDrive {
  readonly id: string;
  readonly webUrl: string;
}

/** One change from a delta page: the item as it is now, or a tombstone for one that is gone. */
export interface DeltaItem extends DriveItem {
  readonly deleted: boolean;
  readonly lastModifiedByName: string | null;
  readonly lastModifiedAt: string | null;
}

export interface DeltaPage {
  readonly items: DeltaItem[];
  /** Token to send next time; null when Graph returned none. */
  readonly token: string | null;
  /** The token given was expired (410 Gone): the caller must resync from scratch (`items` is the full listing). */
  readonly resynced: boolean;
}

export interface UploadSession {
  readonly uploadUrl: string;
  readonly expiresAt: string | null;
}

export interface GraphDriveClientOptions {
  readonly baseUrl: string;
  readonly tokens: GraphTokenSource;
  readonly timeoutMs: number;
  readonly releaseVersion: string;
  readonly metrics: Pick<KrMetrics, "recordTeamsGraphRequest">;
  readonly clock?: Clock;
  readonly breaker?: BreakerTuning | undefined;
  /** Test seam; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  /** Test seam: how to wait between retries (the fake replies with short `Retry-After` values). */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Test seam: deterministic jitter in [0, 1). */
  readonly random?: () => number;
}

/** A Graph call for another client (teams): path under /v1.0, authorised, with the same retries and breaker. */
export interface GraphRequestSpec {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly target: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Parse the answer as a drive item instead of raw JSON. */
  readonly item?: boolean;
}

export interface GraphDriveClient {
  /** The shared transport, for the teams client (one way to call Graph: retries, breaker, metrics, no secrets). */
  request<T>(spec: GraphRequestSpec, signal: AbortSignal): Promise<T>;
  /** Sleep with the client's test seam (for the teams client's folder wait). */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** `GET /sites/{hostname}:/{server-relative-path}` for a site URL (Sites.Selected resolves by path). */
  siteByUrl(siteUrl: string, signal: AbortSignal): Promise<GraphSite>;
  /** The site's default document library. */
  defaultDrive(siteId: string, signal: AbortSignal): Promise<GraphDrive>;
  /** The drive's root folder item. */
  root(driveId: string, signal: AbortSignal): Promise<DriveItem>;
  /** The item at a path under the drive root, or null when there is none. */
  itemByPath(driveId: string, path: string, signal: AbortSignal): Promise<DriveItem | null>;
  item(driveId: string, itemId: string, signal: AbortSignal): Promise<DriveItem | null>;
  /** Every child of a folder (all pages). */
  children(driveId: string, itemId: string, signal: AbortSignal): Promise<DriveItem[]>;
  /** Creates a folder; a name already in use is a GraphError with status 409 and code `nameAlreadyExists`. */
  createFolder(driveId: string, parentId: string, name: string, signal: AbortSignal): Promise<DriveItem>;
  /**
   * Changes under a folder since `token` (all pages). Without a token, every item under the folder. A 410 from an
   * expired token restarts from scratch and reports `resynced` (ADR-0015 A4, V7).
   */
  delta(driveId: string, folderItemId: string, token: string | null, signal: AbortSignal): Promise<DeltaPage>;
  /** The content of an item, whole (bounded by `maxBytes`: a larger item is a GraphError `too_large`). */
  download(driveId: string, itemId: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Deletes an item; with `eTag`, only when it is still that version (412 otherwise). */
  deleteItem(driveId: string, itemId: string, eTag: string | null, signal: AbortSignal): Promise<void>;
  /** Simple upload (≤ 4 MiB) under a parent folder; the name must be free (conflictBehavior=fail). */
  uploadSmall(
    driveId: string,
    parentId: string,
    name: string,
    body: Uint8Array,
    signal: AbortSignal,
  ): Promise<DriveItem>;
  /** Starts a resumable upload for a large file; the returned URL is used with `uploadChunk`. */
  createUploadSession(driveId: string, parentId: string, name: string, signal: AbortSignal): Promise<UploadSession>;
  /** Sends one chunk; resolves to the finished item on the last chunk, null before that. */
  uploadChunk(
    session: UploadSession,
    chunk: Uint8Array,
    offset: number,
    totalBytes: number,
    signal: AbortSignal,
  ): Promise<DriveItem | null>;
}

interface RawItem {
  id?: unknown;
  name?: unknown;
  eTag?: unknown;
  size?: unknown;
  folder?: unknown;
  webUrl?: unknown;
  createdBy?: { application?: { id?: unknown } };
  lastModifiedBy?: { user?: { displayName?: unknown }; application?: { displayName?: unknown } };
  lastModifiedDateTime?: unknown;
  parentReference?: { id?: unknown; path?: unknown };
  deleted?: unknown;
}

function toDeltaItem(raw: RawItem): DeltaItem {
  const item = toDriveItem(raw);
  const by = raw.lastModifiedBy?.user?.displayName ?? raw.lastModifiedBy?.application?.displayName;
  return {
    ...item,
    deleted: typeof raw.deleted === "object" && raw.deleted !== null,
    lastModifiedByName: str(by)?.slice(0, 200) ?? null,
    lastModifiedAt: str(raw.lastModifiedDateTime),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function toDriveItem(raw: RawItem): DriveItem {
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) throw new GraphError("Graph returned an item without an id or a name.", 200, "malformed_item");
  return {
    id,
    name,
    eTag: str(raw.eTag),
    size: typeof raw.size === "number" ? raw.size : null,
    isFolder: typeof raw.folder === "object" && raw.folder !== null,
    webUrl: str(raw.webUrl),
    createdByAppId: str(raw.createdBy?.application?.id),
    parentId: str(raw.parentReference?.id),
    parentPath: parentPathOf(str(raw.parentReference?.path)),
  };
}

/** `/drive/root:/a/b` or `/drives/{id}/root:/a/b` → `/a/b`; the root itself → ``; unknown → null. */
export function parentPathOf(path: string | null): string | null {
  if (path === null) return null;
  const stripped = path.replace(/^\/drives\/[^/]+\/root:/, "").replace(/^\/drive\/root:/, "");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

/** `https://contoso.sharepoint.com/sites/TeamSurvey` → `contoso.sharepoint.com:/sites/TeamSurvey` for `GET /sites/…`. */
export function sitePathOf(siteUrl: string): string {
  const url = new URL(siteUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.hostname}:${path.length > 0 ? path : "/"}`;
}

function statusClass(status: number | null): Parameters<KrMetrics["recordTeamsGraphRequest"]>[0] {
  if (status === null) return "network";
  if (status === 429) return "429";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return "2xx";
}

function retryAfterMs(res: Response, clock: Clock): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - clock.now().getTime()) : null;
}

const RETRIABLE = new Set([429, 503, 504]);

export function createGraphDriveClient(o: GraphDriveClientOptions): GraphDriveClient {
  const doFetch = o.fetch ?? fetch;
  const clock = o.clock ?? systemClock;
  const random = o.random ?? Math.random;
  const sleep =
    o.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }));
  const base = `${o.baseUrl.replace(/\/+$/, "")}/v1.0`;
  // Upload-session URLs must be https; only a local fake (an http base URL, refused outside local by config) may be http.
  const sessionScheme = base.startsWith("http://") ? "http://" : "https://";
  const userAgent = `${GRAPH_USER_AGENT_PREFIX}/${o.releaseVersion}`;
  const breaker = createCircuitBreaker({
    name: "graph",
    failureThreshold: BREAKER_FAILURE_THRESHOLD,
    coolDownMs: BREAKER_COOL_DOWN_MS,
    clock,
    ...o.breaker,
    isFailure: (error) => (error instanceof GraphError || error instanceof GraphTokenError) && isDown(error),
    isCancel: (error) => error instanceof Error && error.name === "AbortError",
  });

  function isDown(error: GraphError | GraphTokenError): boolean {
    return error instanceof GraphError ? error.unavailable : error.status === null || error.status >= 500;
  }

  interface Call {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    /** Path under /v1.0 (authorised) or an absolute upload-session URL (not authorised). */
    readonly target: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: Uint8Array | string;
    readonly authorised: boolean;
    /** Statuses that are an answer, not an error (404 for lookups). */
    readonly accept?: readonly number[];
  }

  /** One attempt: builds the request, maps failures to GraphError. */
  async function attempt(call: Call, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { "user-agent": userAgent, accept: "application/json", ...call.headers };
    // One deadline per attempt (TEAMS_GRAPH_TIMEOUT_MS) on top of the operation's own signal.
    const timed = AbortSignal.any([signal, AbortSignal.timeout(o.timeoutMs)]);
    if (call.authorised) headers.authorization = `Bearer ${await o.tokens.token(timed)}`;
    let res: Response;
    try {
      res = await doFetch(
        call.target.startsWith("https://") || call.target.startsWith("http://") ? call.target : `${base}${call.target}`,
        {
          method: call.method,
          headers,
          ...(call.body === undefined ? {} : { body: call.body }),
          signal: timed,
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      o.metrics.recordTeamsGraphRequest("network");
      throw new GraphError("Microsoft Graph could not be reached.", null, null, { cause: error });
    }
    o.metrics.recordTeamsGraphRequest(statusClass(res.status));
    if (res.ok || call.accept?.includes(res.status)) return res;
    const code = await readErrorCode(res);
    throw new GraphError(`Microsoft Graph answered ${res.status}.`, res.status, code, {
      retryAfterMs: RETRIABLE.has(res.status) ? retryAfterMs(res, clock) : null,
    });
  }

  /** Retries throttling and outages within the bound, refreshes the token once on 401, under the circuit breaker. */
  async function send(call: Call, signal: AbortSignal): Promise<Response> {
    let refreshed = false;
    for (let retries = 0; ; retries += 1) {
      try {
        return await breaker.run(() => attempt(call, signal));
      } catch (error) {
        if (signal.aborted || error instanceof CircuitOpenError) throw error;
        if (error instanceof GraphError && error.status === 401 && call.authorised && !refreshed) {
          o.tokens.invalidate();
          refreshed = true;
          continue;
        }
        const retriable =
          error instanceof GraphError &&
          (error.status === null || RETRIABLE.has(error.status)) &&
          retries < MAX_RETRIES;
        if (!retriable) throw error;
        const backoff = Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** retries) * (0.5 + random() / 2);
        const wait = error.retryAfterMs ?? backoff;
        if (wait > MAX_RETRY_WAIT_MS) throw error;
        await sleep(wait, signal);
      }
    }
  }

  async function json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new GraphError("Microsoft Graph returned an unreadable body.", res.status, "malformed_body", {
        cause: error,
      });
    }
  }

  const encodePath = (path: string) =>
    path
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");

  return {
    sleep,
    async request<T>(spec: GraphRequestSpec, signal: AbortSignal): Promise<T> {
      const res = await send(
        {
          method: spec.method,
          target: spec.target,
          ...(spec.headers ? { headers: spec.headers } : {}),
          ...(spec.body === undefined ? {} : { body: spec.body }),
          authorised: true,
        },
        signal,
      );
      if (res.status === 204) return undefined as T;
      if (spec.item) return toDriveItem(await json<RawItem>(res)) as T;
      return json<T>(res);
    },
    async siteByUrl(siteUrl, signal) {
      const res = await send({ method: "GET", target: `/sites/${sitePathOf(siteUrl)}`, authorised: true }, signal);
      const body = await json<{ id?: unknown; webUrl?: unknown; displayName?: unknown }>(res);
      const id = str(body.id);
      const webUrl = str(body.webUrl);
      if (!id || !webUrl) throw new GraphError("Graph returned a site without an id.", res.status, "malformed_site");
      return { id, webUrl, displayName: str(body.displayName) };
    },
    async defaultDrive(siteId, signal) {
      const res = await send(
        { method: "GET", target: `/sites/${encodeURIComponent(siteId)}/drive`, authorised: true },
        signal,
      );
      const body = await json<{ id?: unknown; webUrl?: unknown }>(res);
      const id = str(body.id);
      const webUrl = str(body.webUrl);
      if (!id || !webUrl) throw new GraphError("Graph returned a drive without an id.", res.status, "malformed_drive");
      return { id, webUrl };
    },
    async root(driveId, signal) {
      const res = await send(
        { method: "GET", target: `/drives/${encodeURIComponent(driveId)}/root`, authorised: true },
        signal,
      );
      return toDriveItem(await json<RawItem>(res));
    },
    async itemByPath(driveId, path, signal) {
      const res = await send(
        {
          method: "GET",
          target: `/drives/${encodeURIComponent(driveId)}/root:/${encodePath(path)}`,
          authorised: true,
          accept: [404],
        },
        signal,
      );
      if (res.status === 404) return null;
      return toDriveItem(await json<RawItem>(res));
    },
    async item(driveId, itemId, signal) {
      const res = await send(
        {
          method: "GET",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
          authorised: true,
          accept: [404],
        },
        signal,
      );
      if (res.status === 404) return null;
      return toDriveItem(await json<RawItem>(res));
    },
    async children(driveId, itemId, signal) {
      const items: DriveItem[] = [];
      let target: string | null =
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200`;
      while (target !== null) {
        const res = await send({ method: "GET", target, authorised: true }, signal);
        const body = await json<{ value?: unknown; "@odata.nextLink"?: unknown }>(res);
        if (!Array.isArray(body.value))
          throw new GraphError("Graph returned no item list.", res.status, "malformed_list");
        for (const raw of body.value as RawItem[]) items.push(toDriveItem(raw));
        const next = str(body["@odata.nextLink"]);
        // the next link is absolute and already carries the drive and folder; it must stay on Graph's own host
        target = next?.startsWith(`${base}/`) ? next.slice(base.length) : null;
      }
      return items;
    },
    async createFolder(driveId, parentId, name, signal) {
      const res = await send(
        {
          method: "POST",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
          authorised: true,
        },
        signal,
      );
      return toDriveItem(await json<RawItem>(res));
    },
    async delta(driveId, folderItemId, token, signal) {
      const items: DeltaItem[] = [];
      let resynced = false;
      let target: string | null =
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}/delta` +
        (token ? `?token=${encodeURIComponent(token)}` : "");
      let nextToken: string | null = null;
      while (target !== null) {
        const res = await send({ method: "GET", target, authorised: true, accept: [410] }, signal);
        if (res.status === 410) {
          // the token expired: Graph wants a fresh start
          if (resynced) throw new GraphError("Delta restarted twice.", 410, "resyncRequired");
          resynced = true;
          items.length = 0;
          target = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}/delta`;
          continue;
        }
        const body = await json<{ value?: unknown; "@odata.nextLink"?: unknown; "@odata.deltaLink"?: unknown }>(res);
        if (!Array.isArray(body.value))
          throw new GraphError("Graph returned no delta list.", res.status, "malformed_list");
        for (const raw of body.value as RawItem[]) {
          // a tombstone has no name worth keeping; keep the id
          if (typeof raw.deleted === "object" && raw.deleted !== null && !str(raw.name)) raw.name = "(deleted)";
          items.push(toDeltaItem(raw));
        }
        const next = str(body["@odata.nextLink"]);
        const deltaLink = str(body["@odata.deltaLink"]);
        if (deltaLink) {
          try {
            nextToken = new URL(deltaLink).searchParams.get("token");
          } catch {
            nextToken = null;
          }
        }
        target = next?.startsWith(`${base}/`) ? next.slice(base.length) : null;
      }
      return { items, token: nextToken, resynced };
    },
    async download(driveId, itemId, maxBytes, signal) {
      const res = await send(
        {
          method: "GET",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
          authorised: true,
        },
        signal,
      );
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new GraphError("The item is larger than the upload limit.", 413, "too_large");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes)
        throw new GraphError("The item is larger than the upload limit.", 413, "too_large");
      return bytes;
    },
    async deleteItem(driveId, itemId, eTag, signal) {
      await send(
        {
          method: "DELETE",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
          ...(eTag ? { headers: { "if-match": eTag } } : {}),
          authorised: true,
        },
        signal,
      );
    },
    async uploadSmall(driveId, parentId, name, body, signal) {
      if (body.byteLength > SIMPLE_UPLOAD_MAX_BYTES) throw new RangeError("uploadSmall is for files up to 4 MiB");
      const res = await send(
        {
          method: "PUT",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`,
          headers: { "content-type": "application/octet-stream" },
          body,
          authorised: true,
        },
        signal,
      );
      return toDriveItem(await json<RawItem>(res));
    },
    async createUploadSession(driveId, parentId, name, signal) {
      const res = await send(
        {
          method: "POST",
          target: `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/createUploadSession`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name } }),
          authorised: true,
        },
        signal,
      );
      const body = await json<{ uploadUrl?: unknown; expirationDateTime?: unknown }>(res);
      const uploadUrl = str(body.uploadUrl);
      if (!uploadUrl?.startsWith(sessionScheme)) {
        throw new GraphError("Graph returned no upload URL.", res.status, "malformed_session");
      }
      return { uploadUrl, expiresAt: str(body.expirationDateTime) };
    },
    async uploadChunk(session, chunk, offset, totalBytes, signal) {
      const end = offset + chunk.byteLength - 1;
      // The session URL carries its own authorisation: no bearer token (decision 9).
      const res = await send(
        {
          method: "PUT",
          target: session.uploadUrl,
          headers: {
            "content-range": `bytes ${offset}-${end}/${totalBytes}`,
            "content-length": String(chunk.byteLength),
          },
          body: chunk,
          authorised: false,
        },
        signal,
      );
      if (res.status === 202) return null;
      return toDriveItem(await json<RawItem>(res));
    },
  };
}
