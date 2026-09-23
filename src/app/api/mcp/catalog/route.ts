import { rejectForeignOrigin } from "@/app/api/settings/origin";
import type { CatalogHeader, CatalogItem, CatalogResponse } from "@/lib/mcp-catalog-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catalog of remote MCP servers from the official MCP Registry, simplified for the settings UI.
 * Only servers with `remotes` (streamable-http / sse) are returned: Jarvis cannot run local packages.
 */

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const TIMEOUT_MS = 8000;
const TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;

type RegistryHeader = { name?: unknown; description?: unknown; isRequired?: unknown; isSecret?: unknown; value?: unknown };
type RegistryRemote = { type?: unknown; url?: unknown; headers?: RegistryHeader[] };
type RegistryEntry = {
  server?: {
    name?: unknown;
    title?: unknown;
    description?: unknown;
    websiteUrl?: unknown;
    repository?: { url?: unknown };
    remotes?: RegistryRemote[];
  };
  _meta?: Record<string, { updatedAt?: unknown; status?: unknown } | undefined>;
};

const cache = new Map<string, { at: number; data: CatalogResponse }>();
const inflight = new Map<string, Promise<CatalogResponse>>();

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const httpUrl = (v: unknown) => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : null;
};

function toItem(entry: RegistryEntry): CatalogItem | null {
  const s = entry.server;
  const name = str(s?.name);
  if (!s || !name || !Array.isArray(s.remotes)) return null;
  const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
  if (str(meta?.status) && str(meta?.status) !== "active") return null;

  const remotes = s.remotes.filter(
    (r): r is RegistryRemote & { type: "streamable-http" | "sse"; url: string } =>
      (r?.type === "streamable-http" || r?.type === "sse") && typeof r.url === "string" && /^https?:\/\//i.test(r.url),
  );
  if (!remotes.length) return null;
  // Prefer streamable HTTP, then a URL without {placeholders}.
  const score = (r: (typeof remotes)[number]) => (r.type === "streamable-http" ? 0 : 2) + (/\{[^}]*\}/.test(r.url) ? 1 : 0);
  const remote = [...remotes].sort((a, b) => score(a) - score(b))[0];

  const headers: CatalogHeader[] = [];
  let hasAuthorization = false;
  let authorizationIsBearer = true;
  for (const h of Array.isArray(remote.headers) ? remote.headers : []) {
    const hName = str(h?.name);
    if (!hName) continue;
    const description = str(h.description);
    if (hName.toLowerCase() === "authorization") {
      hasAuthorization = true;
      // OpenAI always sends "Authorization: Bearer <token>"; other schemes (Basic, raw key) must go as a plain header.
      const value = str(h.value);
      if (value && !/^bearer\b/i.test(value)) authorizationIsBearer = false;
      else if (!value && /^(basic|token)\b/i.test(description)) authorizationIsBearer = false;
    }
    headers.push({ name: hName, description, isRequired: h.isRequired === true, isSecret: h.isSecret === true });
  }
  const otherRequired = headers.some((h) => h.isRequired && (h.name.toLowerCase() !== "authorization" || !authorizationIsBearer));
  const auth: CatalogItem["auth"] =
    hasAuthorization && authorizationIsBearer ? "token" : otherRequired || hasAuthorization ? "headers" : "none";

  return {
    name,
    title: str(s.title) || name.split("/").pop() || name,
    description: str(s.description),
    websiteUrl: httpUrl(s.websiteUrl),
    repositoryUrl: httpUrl(s.repository?.url),
    url: remote.url,
    transport: remote.type,
    auth,
    headers,
    needsUrlEdit: /\{[^}]*\}/.test(remote.url),
    updatedAt: str(meta?.updatedAt) || null,
  };
}

async function load(q: string, cursor: string): Promise<CatalogResponse> {
  const params = new URLSearchParams({ limit: "100", version: "latest" });
  if (q) params.set("search", q);
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${REGISTRY}?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const body = (await res.json()) as { servers?: RegistryEntry[]; metadata?: { nextCursor?: unknown } };

  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  const items: CatalogItem[] = [];
  for (const entry of Array.isArray(body.servers) ? body.servers : []) {
    const item = toItem(entry);
    if (!item) continue;
    const urlKey = item.url.replace(/\/+$/, "").toLowerCase();
    if (seenNames.has(item.name) || seenUrls.has(urlKey)) continue;
    seenNames.add(item.name);
    seenUrls.add(urlKey);
    items.push(item);
  }

  const needle = q.toLowerCase();
  // Whole-word match, so "f1" doesn't favour a hash like "…ad46e3f1".
  const word = needle ? new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i") : null;
  const matches = (i: CatalogItem) => !!word && (word.test(i.title) || word.test(i.name));
  const time = (i: CatalogItem) => (i.updatedAt ? Date.parse(i.updatedAt) || 0 : 0);
  items.sort((a, b) => Number(matches(b)) - Number(matches(a)) || Number(!!b.websiteUrl) - Number(!!a.websiteUrl) || time(b) - time(a));

  return { items, nextCursor: str(body.metadata?.nextCursor) || null };
}

export async function GET(request: Request) {
  const denied = rejectForeignOrigin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const cursor = (searchParams.get("cursor") ?? "").slice(0, 300);
  const key = `${q.toLowerCase()}\u0000${cursor}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.data);

  let pending = inflight.get(key);
  if (!pending) {
    pending = load(q, cursor).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const data = await pending;
    cache.delete(key);
    cache.set(key, { at: Date.now(), data });
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return Response.json(data);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return Response.json(
      { error: timedOut ? "Katalog MCP serverů neodpověděl včas. Zkus to za chvíli." : "Katalog MCP serverů se nepodařilo načíst." },
      { status: 502 },
    );
  }
}
