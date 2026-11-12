/**
 * A local stand-in for login.microsoftonline.com and graph.microsoft.com for the Teams integration (ADR-0015, WP-25
 * step 5; the fake-clamd / fake-anthropic pattern). It models the token endpoint and the drive subset the worker uses:
 * sites by path, default drives, items by path or id, children, folder creation (409 nameAlreadyExists), delete with
 * If-Match, simple upload, upload sessions with chunks. Sites exist only when added; a site without `writable` answers
 * 403 accessDenied to writes (a missing Sites.Selected grant). Failures can be injected: the next N responses with a
 * status and Retry-After, a one-off 401 (token expiry), a crash after an upload has been stored but before the reply.
 * Every request is recorded. No test ever calls a Microsoft host.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

export interface FakeItem {
  readonly id: string;
  name: string;
  readonly isFolder: boolean;
  readonly parentId: string | null;
  content: Buffer;
  eTag: string;
  readonly createdByAppId: string;
  modifiedByName: string;
  modifiedAt: string;
}

export interface FakeSite {
  readonly id: string;
  readonly webUrl: string;
  readonly displayName: string;
  readonly driveId: string;
  readonly rootId: string;
  writable: boolean;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
}

export interface Injected {
  readonly status: number;
  readonly retryAfter?: string;
  readonly code?: string;
}

export interface FakeGraph {
  readonly baseUrl: string;
  readonly authorityHost: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly requests: RecordedRequest[];
  /** Tokens handed out so far (to assert the worker refreshed after a 401). */
  readonly tokensIssued: number;
  addSite(siteUrl: string, o?: { writable?: boolean; displayName?: string }): FakeSite;
  site(siteUrl: string): FakeSite | undefined;
  /** The items of a drive, by id. */
  items(driveId: string): Map<string, FakeItem>;
  /** The item at a path under the drive root. */
  itemAt(driveId: string, path: string): FakeItem | undefined;
  /** Adds a folder or file directly (something already in Teams). */
  seed(driveId: string, parentId: string, name: string, content?: Buffer, createdByAppId?: string): FakeItem;
  /** The next `count` Graph (not token) responses answer with this instead. */
  failNext(count: number, injected: Injected): void;
  /** The next authorised Graph call answers 401 once (an expired token). */
  expireTokenOnce(): void;
  /** The next upload stores its bytes and then drops the connection without a reply. */
  crashAfterNextUpload(): void;
  /** When on, a new folder's eTag changes right after the create answers, as SharePoint does. */
  restampNewFolders(on: boolean): void;
  /** When set, token requests fail with this status. */
  refuseTokens(status: number | null): void;
  /** Overwrites an item's content as a person editing it in Teams would (new eTag, modifier). */
  edit(driveId: string, itemId: string, content: Buffer, by?: string): void;
  /** Deletes an item as a person would in Teams (a tombstone appears in the next delta). */
  remove(driveId: string, itemId: string): void;
  /** The next delta call with a token answers 410 Gone (expired token). */
  expireDeltaOnce(): void;
  /** A team whose channels live in `site` (their folders at the library root). */
  addTeam(teamId: string, site: FakeSite, o?: { channelsAllowed?: boolean; createAllowed?: boolean }): void;
  /** Adds a channel to a team as KR would in Teams (its folder appears in the site). */
  addChannel(
    teamId: string,
    name: string,
    membershipType?: "standard" | "private" | "shared",
  ): { id: string; name: string };
  channels(teamId: string): { id: string; name: string; membershipType: string }[];
  /** The channel's Files folder appears only after this many filesFolder calls (Teams creates it lazily). */
  delayFilesFolder(calls: number): void;
  stop(): Promise<void>;
}

const UPLOAD_PATH = "/_upload/";

/** Writes a JSON reply; returns true so a route handler can `return json(...)` (handled). */
function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
  return true;
}

function problem(res: ServerResponse, status: number, code: string, headers: Record<string, string> = {}): true {
  return json(res, status, { error: { code, message: "fake" } }, headers);
}

export async function startFakeGraph(o: { tenantId?: string; appId?: string } = {}): Promise<FakeGraph> {
  const tenantId = o.tenantId ?? "11111111-1111-4111-8111-111111111111";
  const appId = o.appId ?? "22222222-2222-4222-8222-222222222222";
  const sites = new Map<string, FakeSite>();
  const drives = new Map<string, Map<string, FakeItem>>();
  const sessions = new Map<
    string,
    { driveId: string; parentId: string; name: string; chunks: Buffer[]; received: number }
  >();
  const requests: RecordedRequest[] = [];
  const injected: Injected[] = [];
  let expireToken = false;
  let crashNextUpload = false;
  let restampFolders = false;
  let refuseTokens: number | null = null;
  let expireDelta = false;
  const teams = new Map<
    string,
    {
      site: FakeSite;
      channelsAllowed: boolean;
      createAllowed: boolean;
      channels: { id: string; name: string; membershipType: string; folderId: string | null }[];
    }
  >();
  let filesFolderDelay = 0;
  /** Every change in order: (driveId, itemId, deleted?); a delta token is an index into this log. */
  const changes: { driveId: string; itemId: string; deleted: boolean }[] = [];
  const tombstones = new Map<string, { driveId: string; parentId: string | null; name: string }>();
  let tokensIssued = 0;
  let currentToken = "";
  let nextId = 1;
  const newId = (prefix: string) => `${prefix}${String(nextId++).padStart(6, "0")}`;
  const newTag = () => `"{${randomUUID()}},1"`;

  const pathOf = (items: Map<string, FakeItem>, parentId: string | null): string => {
    const parts: string[] = [];
    let current = parentId ? items.get(parentId) : undefined;
    while (current && current.parentId !== null) {
      parts.unshift(current.name);
      current = items.get(current.parentId);
    }
    return `/drive/root:${parts.length ? `/${parts.join("/")}` : ""}`;
  };
  const render = (item: FakeItem, items?: Map<string, FakeItem>) => ({
    id: item.id,
    name: item.name,
    eTag: item.eTag,
    size: item.isFolder ? 0 : item.content.byteLength,
    ...(item.isFolder ? { folder: { childCount: 0 } } : { file: {} }),
    webUrl: `https://fake.sharepoint.test/items/${item.id}`,
    createdBy: { application: { id: item.createdByAppId } },
    lastModifiedBy: { user: { displayName: item.modifiedByName } },
    lastModifiedDateTime: item.modifiedAt,
    parentReference: { id: item.parentId, ...(items ? { path: pathOf(items, item.parentId) } : {}) },
  });
  const record = (driveId: string, itemId: string, deleted = false) => {
    changes.push({ driveId, itemId, deleted });
  };
  const stamp = () => new Date().toISOString();

  function sitePath(u: string): string {
    const url = new URL(u);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}:${path.length > 0 ? path : "/"}`;
  }

  function addSite(siteUrl: string, opt: { writable?: boolean; displayName?: string } = {}): FakeSite {
    const driveId = newId("b!drive");
    const rootId = newId("01ROOT");
    const site: FakeSite = {
      id: `fake.sharepoint.test,${randomUUID()},${randomUUID()}`,
      webUrl: siteUrl.replace(/\/+$/, ""),
      displayName: opt.displayName ?? "Fake site",
      driveId,
      rootId,
      writable: opt.writable ?? true,
    };
    sites.set(sitePath(siteUrl), site);
    const items = new Map<string, FakeItem>();
    items.set(rootId, {
      id: rootId,
      name: "root",
      isFolder: true,
      parentId: null,
      content: Buffer.alloc(0),
      eTag: newTag(),
      createdByAppId: "sharepoint",
      modifiedByName: "SharePoint",
      modifiedAt: stamp(),
    });
    drives.set(driveId, items);
    return site;
  }

  function childrenOf(items: Map<string, FakeItem>, parentId: string): FakeItem[] {
    return [...items.values()].filter((i) => i.parentId === parentId);
  }

  function itemAt(driveId: string, path: string): FakeItem | undefined {
    const items = drives.get(driveId);
    if (!items) return undefined;
    const site = [...sites.values()].find((s) => s.driveId === driveId);
    let current = site ? items.get(site.rootId) : undefined;
    for (const part of path.split("/").filter((p) => p.length > 0)) {
      if (!current) return undefined;
      current = childrenOf(items, current.id).find((c) => c.name === part);
    }
    return current;
  }

  function seed(
    driveId: string,
    parentId: string,
    name: string,
    content?: Buffer,
    createdByAppId = "person",
  ): FakeItem {
    const items = drives.get(driveId);
    if (!items?.has(parentId)) throw new Error("unknown drive or parent");
    // a seed without content is a folder (channel and template folders carry dots in their names)
    const isFolder = content === undefined;
    content ??= Buffer.alloc(0);
    const item: FakeItem = {
      id: newId(isFolder ? "01F" : "01X"),
      name,
      isFolder,
      parentId,
      content,
      eTag: newTag(),
      createdByAppId,
      modifiedByName: createdByAppId === appId ? "KR Tracker" : "Sam Surveyor",
      modifiedAt: stamp(),
    };
    items.set(item.id, item);
    record(driveId, item.id);
    return item;
  }

  /** Every descendant of a folder (depth first). */
  function descendants(items: Map<string, FakeItem>, folderId: string): FakeItem[] {
    const out: FakeItem[] = [];
    for (const child of childrenOf(items, folderId)) {
      out.push(child);
      if (child.isFolder) out.push(...descendants(items, child.id));
    }
    return out;
  }

  function removeItem(driveId: string, itemId: string): void {
    const items = drives.get(driveId);
    const item = items?.get(itemId);
    if (!items || !item) return;
    for (const d of descendants(items, itemId)) {
      tombstones.set(d.id, { driveId, parentId: d.parentId, name: d.name });
      items.delete(d.id);
      record(driveId, d.id, true);
    }
    tombstones.set(itemId, { driveId, parentId: item.parentId, name: item.name });
    items.delete(itemId);
    record(driveId, itemId, true);
  }

  function addChannel(teamId: string, name: string, membershipType: "standard" | "private" | "shared" = "standard") {
    const team = teams.get(teamId);
    if (!team) throw new Error("unknown team");
    const id = `19:${randomUUID().replaceAll("-", "")}@thread.tacv2`;
    const folder = membershipType === "standard" ? seed(team.site.driveId, team.site.rootId, name) : null;
    team.channels.push({ id, name, membershipType, folderId: folder?.id ?? null });
    return { id, name };
  }

  function handleTeams(req: IncomingMessage, res: ServerResponse, path: string, body: Buffer): boolean | null {
    let m: RegExpExecArray | null;
    if ((m = /^\/teams\/([^/]+)\/channels$/.exec(path))) {
      const team = teams.get(m[1] ?? "");
      if (!team) return problem(res, 404, "NotFound");
      if (req.method === "GET") {
        if (!team.channelsAllowed) return problem(res, 403, "Forbidden");
        return json(res, 200, {
          value: team.channels.map((c) => ({ id: c.id, displayName: c.name, membershipType: c.membershipType })),
        });
      }
      if (req.method === "POST") {
        if (!team.createAllowed) return problem(res, 403, "Forbidden");
        const payload = JSON.parse(body.toString("utf8")) as { displayName?: string };
        const name = payload.displayName ?? "";
        if (!name || name.length > 50) return problem(res, 400, "BadRequest");
        if (team.channels.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return problem(res, 409, "nameAlreadyExists");
        const created = addChannel(m[1] ?? "", name);
        return json(res, 201, { id: created.id, displayName: created.name, membershipType: "standard" });
      }
    }
    if (req.method === "GET" && (m = /^\/teams\/([^/]+)\/channels\/([^/]+)\/filesFolder$/.exec(path))) {
      const team = teams.get(m[1] ?? "");
      const channel = team?.channels.find((c) => c.id === m?.[2]);
      if (!team || !channel) return problem(res, 404, "NotFound");
      if (filesFolderDelay > 0) {
        filesFolderDelay -= 1;
        return problem(res, 404, "NotFound");
      }
      const items = drives.get(team.site.driveId);
      const folder = channel.folderId ? items?.get(channel.folderId) : undefined;
      if (!folder || !items) return problem(res, 404, "NotFound");
      return json(res, 200, {
        ...render(folder, items),
        parentReference: { driveId: team.site.driveId, id: folder.parentId },
      });
    }
    return null;
  }

  function siteOfDrive(driveId: string): FakeSite | undefined {
    return [...sites.values()].find((s) => s.driveId === driveId);
  }

  function handleGraph(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): boolean {
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
    const auth = req.headers.authorization;
    if (url.pathname.startsWith(UPLOAD_PATH)) return handleUpload(req, res, url, body);
    if (auth !== `Bearer ${currentToken}` || expireToken) {
      expireToken = false;
      return problem(res, 401, "InvalidAuthenticationToken");
    }
    const next = injected.shift();
    if (next)
      return problem(res, next.status, next.code ?? "fake", next.retryAfter ? { "retry-after": next.retryAfter } : {});

    const teamsAnswer = handleTeams(req, res, path, body);
    if (teamsAnswer !== null) return teamsAnswer;
    let m: RegExpExecArray | null;
    // GET /sites/{host}:/{path}
    if (req.method === "GET" && (m = /^\/sites\/([^/]+:\/.*|[^/]+:\/)$/.exec(path)) && !path.includes("/drive")) {
      const key = m[1]?.replace(/\/+$/, "") ?? "";
      const site = sites.get(key.endsWith(":") ? `${key}/` : key);
      if (!site) return problem(res, 404, "itemNotFound");
      return json(res, 200, { id: site.id, webUrl: site.webUrl, displayName: site.displayName });
    }
    // GET /sites/{id}/drive
    if (req.method === "GET" && (m = /^\/sites\/(.+)\/drive$/.exec(path))) {
      const site = [...sites.values()].find((s) => s.id === m?.[1]);
      if (!site) return problem(res, 404, "itemNotFound");
      return json(res, 200, { id: site.driveId, webUrl: `${site.webUrl}/Shared%20Documents` });
    }
    // GET /drives/{id}/root
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/root$/.exec(path))) {
      const site = siteOfDrive(m[1] ?? "");
      const items = site ? drives.get(site.driveId) : undefined;
      const root = site ? items?.get(site.rootId) : undefined;
      return root && items ? json(res, 200, render(root, items)) : problem(res, 404, "itemNotFound");
    }
    // GET /drives/{id}/items/{item}/delta[?token=n]
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)\/delta$/.exec(path))) {
      const [, driveId = "", folderId = ""] = m;
      const items = drives.get(driveId);
      if (!items?.has(folderId)) return problem(res, 404, "itemNotFound");
      const token = url.searchParams.get("token");
      if (token && expireDelta) {
        expireDelta = false;
        return problem(res, 410, "resyncRequired");
      }
      const under = (id: string): boolean => {
        let cur = items.get(id);
        while (cur) {
          if (cur.id === folderId) return true;
          cur = cur.parentId ? items.get(cur.parentId) : undefined;
        }
        const t = tombstones.get(id);
        return t?.parentId === folderId || (t?.parentId ? under(t.parentId) : false);
      };
      const value: unknown[] = [];
      if (!token) {
        for (const d of descendants(items, folderId)) value.push(render(d, items));
      } else {
        const since = Number(token);
        const seen = new Set<string>();
        for (const c of changes.slice(since).reverse()) {
          if (c.driveId !== driveId || seen.has(c.itemId) || !under(c.itemId)) continue;
          seen.add(c.itemId);
          const live = items.get(c.itemId);
          if (live) value.unshift(render(live, items));
          else if (c.deleted)
            value.unshift({
              id: c.itemId,
              name: "(deleted)",
              deleted: { state: "deleted" },
              parentReference: { id: tombstones.get(c.itemId)?.parentId ?? null },
            });
        }
      }
      return json(res, 200, {
        value,
        "@odata.deltaLink": `${baseUrlRef.value}/v1.0/drives/${driveId}/items/${folderId}/delta?token=${changes.length}`,
      });
    }
    // GET /drives/{id}/items/{item}/content
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)\/content$/.exec(path))) {
      const item = drives.get(m[1] ?? "")?.get(m[2] ?? "");
      if (!item || item.isFolder) return problem(res, 404, "itemNotFound");
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(item.content.byteLength),
      });
      res.end(item.content);
      return true;
    }
    // GET /drives/{id}/root:/{path}
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/root:\/(.*)$/.exec(path))) {
      const items = drives.get(m[1] ?? "");
      const item = itemAt(m[1] ?? "", m[2] ?? "");
      return item && items ? json(res, 200, render(item, items)) : problem(res, 404, "itemNotFound");
    }
    // GET /drives/{id}/items/{item}/children
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)\/children$/.exec(path))) {
      const items = drives.get(m[1] ?? "");
      if (!items?.has(m[2] ?? "")) return problem(res, 404, "itemNotFound");
      return json(res, 200, { value: childrenOf(items, m[2] ?? "").map((c) => render(c, items)) });
    }
    // GET /drives/{id}/items/{item}
    if (req.method === "GET" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)$/.exec(path))) {
      const items = drives.get(m[1] ?? "");
      const item = items?.get(m[2] ?? "");
      return item && items ? json(res, 200, render(item, items)) : problem(res, 404, "itemNotFound");
    }
    // POST /drives/{id}/items/{item}/children (create folder)
    if (req.method === "POST" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)\/children$/.exec(path))) {
      const [, driveId = "", parentId = ""] = m;
      const items = drives.get(driveId);
      if (!items?.has(parentId)) return problem(res, 404, "itemNotFound");
      if (!siteOfDrive(driveId)?.writable) return problem(res, 403, "accessDenied");
      const payload = JSON.parse(body.toString("utf8")) as { name?: string };
      const name = payload.name ?? "";
      if (childrenOf(items, parentId).some((c) => c.name === name)) return problem(res, 409, "nameAlreadyExists");
      const item: FakeItem = {
        id: newId("01F"),
        name,
        isFolder: true,
        parentId,
        content: Buffer.alloc(0),
        eTag: newTag(),
        createdByAppId: appId,
        modifiedByName: "KR Tracker",
        modifiedAt: stamp(),
      };
      items.set(item.id, item);
      record(driveId, item.id);
      json(res, 201, render(item, items));
      if (restampFolders) item.eTag = newTag();
      return true;
    }
    // DELETE /drives/{id}/items/{item}
    if (req.method === "DELETE" && (m = /^\/drives\/([^/]+)\/items\/([^/]+)$/.exec(path))) {
      const [, driveId = "", itemId = ""] = m;
      const items = drives.get(driveId);
      const item = items?.get(itemId);
      if (!items || !item) return problem(res, 404, "itemNotFound");
      if (!siteOfDrive(driveId)?.writable) return problem(res, 403, "accessDenied");
      const ifMatch = req.headers["if-match"];
      if (ifMatch && ifMatch !== item.eTag) return problem(res, 412, "resourceModified");
      removeItem(driveId, itemId);
      res.writeHead(204);
      res.end();
      return true;
    }
    // PUT /drives/{id}/items/{parent}:/{name}:/content (simple upload)
    if (req.method === "PUT" && (m = /^\/drives\/([^/]+)\/items\/([^/]+):\/(.+):\/content$/.exec(path))) {
      const [, driveId = "", parentId = "", name = ""] = m;
      const items = drives.get(driveId);
      if (!items?.has(parentId)) return problem(res, 404, "itemNotFound");
      if (!siteOfDrive(driveId)?.writable) return problem(res, 403, "accessDenied");
      if (childrenOf(items, parentId).some((c) => c.name === name)) return problem(res, 409, "nameAlreadyExists");
      const item: FakeItem = {
        id: newId("01X"),
        name,
        isFolder: false,
        parentId,
        content: body,
        eTag: newTag(),
        createdByAppId: appId,
        modifiedByName: "KR Tracker",
        modifiedAt: stamp(),
      };
      items.set(item.id, item);
      record(driveId, item.id);
      if (crashNextUpload) {
        crashNextUpload = false;
        req.socket.destroy();
        return true;
      }
      return json(res, 201, render(item, items));
    }
    // POST /drives/{id}/items/{parent}:/{name}:/createUploadSession
    if (req.method === "POST" && (m = /^\/drives\/([^/]+)\/items\/([^/]+):\/(.+):\/createUploadSession$/.exec(path))) {
      const [, driveId = "", parentId = "", name = ""] = m;
      const items = drives.get(driveId);
      if (!items?.has(parentId)) return problem(res, 404, "itemNotFound");
      if (!siteOfDrive(driveId)?.writable) return problem(res, 403, "accessDenied");
      if (childrenOf(items, parentId).some((c) => c.name === name)) return problem(res, 409, "nameAlreadyExists");
      const sessionId = randomUUID();
      sessions.set(sessionId, { driveId, parentId, name, chunks: [], received: 0 });
      return json(res, 200, {
        uploadUrl: `${baseUrlRef.value}${UPLOAD_PATH}${sessionId}`,
        expirationDateTime: "2099-01-01T00:00:00Z",
      });
    }
    return problem(res, 404, "unknown_route");
  }

  function handleUpload(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): boolean {
    if (req.headers.authorization) return problem(res, 400, "authorization_header_on_session_url");
    const session = sessions.get(url.pathname.slice(UPLOAD_PATH.length));
    if (!session) return problem(res, 404, "sessionNotFound");
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["content-range"] ?? "");
    if (!range) return problem(res, 400, "invalidRange");
    const [, start = "0", end = "0", total = "0"] = range;
    if (Number(start) !== session.received) return problem(res, 416, "invalidRange");
    session.chunks.push(body);
    session.received = Number(end) + 1;
    if (session.received < Number(total)) return json(res, 202, { nextExpectedRanges: [`${session.received}-`] });
    const items = drives.get(session.driveId);
    if (!items) return problem(res, 404, "itemNotFound");
    const item: FakeItem = {
      id: newId("01X"),
      name: session.name,
      isFolder: false,
      parentId: session.parentId,
      content: Buffer.concat(session.chunks),
      eTag: newTag(),
      createdByAppId: appId,
      modifiedByName: "KR Tracker",
      modifiedAt: stamp(),
    };
    items.set(item.id, item);
    record(session.driveId, item.id);
    sessions.delete(url.pathname.slice(UPLOAD_PATH.length));
    if (crashNextUpload) {
      crashNextUpload = false;
      req.socket.destroy();
      return true;
    }
    return json(res, 201, render(item));
  }

  const baseUrlRef = { value: "" };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://fake");
      requests.push({ method: req.method ?? "", path: url.pathname + url.search, headers: req.headers, body });
      if (url.pathname === `/${tenantId}/oauth2/v2.0/token`) {
        if (refuseTokens !== null) {
          problem(res, refuseTokens, "invalid_client");
          return;
        }
        const form = new URLSearchParams(body.toString("utf8"));
        if (form.get("grant_type") !== "client_credentials" || !form.get("client_secret")) {
          problem(res, 400, "invalid_request");
          return;
        }
        tokensIssued += 1;
        currentToken = `tok-${tokensIssued}-${randomUUID()}`;
        json(res, 200, { access_token: currentToken, token_type: "Bearer", expires_in: 3600 });
        return;
      }
      try {
        handleGraph(req, res, url, body);
      } catch (error) {
        problem(res, 500, error instanceof Error ? error.name : "fake_crash");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrlRef.value = `http://127.0.0.1:${port}`;

  return {
    baseUrl: baseUrlRef.value,
    authorityHost: baseUrlRef.value,
    tenantId,
    appId,
    requests,
    get tokensIssued() {
      return tokensIssued;
    },
    addSite,
    site: (siteUrl) => sites.get(sitePath(siteUrl)),
    items: (driveId) => drives.get(driveId) ?? new Map(),
    itemAt,
    seed,
    failNext(count, inj) {
      for (let i = 0; i < count; i += 1) injected.push(inj);
    },
    expireTokenOnce() {
      expireToken = true;
    },
    crashAfterNextUpload() {
      crashNextUpload = true;
    },
    restampNewFolders(on) {
      restampFolders = on;
    },
    refuseTokens(status) {
      refuseTokens = status;
    },
    edit(driveId, itemId, content, by = "Sam Surveyor") {
      const item = drives.get(driveId)?.get(itemId);
      if (!item) throw new Error("unknown item");
      item.content = content;
      item.eTag = newTag();
      item.modifiedByName = by;
      item.modifiedAt = stamp();
      record(driveId, itemId);
    },
    remove(driveId, itemId) {
      removeItem(driveId, itemId);
    },
    expireDeltaOnce() {
      expireDelta = true;
    },
    addTeam(teamId, site, o = {}) {
      teams.set(teamId, {
        site,
        channelsAllowed: o.channelsAllowed ?? true,
        createAllowed: o.createAllowed ?? true,
        channels: [],
      });
    },
    addChannel,
    channels: (teamId) =>
      (teams.get(teamId)?.channels ?? []).map((c) => ({ id: c.id, name: c.name, membershipType: c.membershipType })),
    delayFilesFolder(calls) {
      filesFolderDelay = calls;
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
