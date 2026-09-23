import { isMasked, publicSettings, readSettings, settingsSchema, writeSettings, type McpServer } from "@/lib/settings";
import { rejectForeignOrigin } from "./origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the browser sends: public settings plus an explicit "delete the stored token" flag per server. */
type IncomingServer = Partial<Omit<McpServer, "headers">> & { headers?: Record<string, string>; clearAuthorization?: boolean };
type IncomingSettings = { voice?: unknown; agentModel?: unknown; mcp?: unknown };

const FIELD: Record<string, string> = {
  voice: "hlas",
  agentModel: "model",
  id: "ID serveru",
  label: "název",
  description: "popis",
  kind: "typ",
  url: "URL",
  connectorId: "konektor",
  authorization: "token",
  headers: "hlavičky",
  allowedTools: "povolené nástroje",
  enabled: "zapnuto",
};

export async function GET(request: Request) {
  const denied = rejectForeignOrigin(request);
  if (denied) return denied;
  return Response.json(publicSettings(await readSettings()));
}

export async function PUT(request: Request) {
  const denied = rejectForeignOrigin(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as IncomingSettings | null;
  if (!body || typeof body !== "object" || (body.mcp !== undefined && !Array.isArray(body.mcp))) {
    return Response.json({ error: "Neplatné tělo požadavku." }, { status: 400 });
  }

  const stored = await readSettings();
  const byId = new Map(stored.mcp.map((m) => [m.id, m]));
  const mcp = ((body.mcp ?? []) as IncomingServer[]).map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const { clearAuthorization, ...m } = raw;
    const prev = typeof m.id === "string" ? byId.get(m.id) : undefined;

    // Token: masked or empty means "keep", unless the user explicitly cleared it.
    let authorization = typeof m.authorization === "string" ? m.authorization.trim() : undefined;
    if (clearAuthorization) authorization = undefined;
    else if (!authorization || isMasked(authorization)) authorization = prev?.authorization;

    // Header values: same rule per key; a masked value without a stored one is dropped.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.headers && typeof m.headers === "object" ? m.headers : {})) {
      const key = k.trim();
      if (!key) continue;
      const value = typeof v === "string" ? v : "";
      const kept = !value || isMasked(value) ? prev?.headers[key] : value;
      if (kept) headers[key] = kept;
    }

    return { ...m, authorization: authorization || undefined, headers };
  });

  const parsed = settingsSchema.safeParse({ ...stored, ...body, mcp });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = [...issue.path].reverse().find((p) => typeof p === "string");
    const idx = issue.path[0] === "mcp" && typeof issue.path[1] === "number" ? issue.path[1] : undefined;
    const where = idx !== undefined ? ` u serveru ${idx + 1}` : "";
    return Response.json({ error: `Neplatná hodnota pole „${FIELD[String(field)] ?? String(field ?? "?")}“${where}.` }, { status: 400 });
  }

  for (const m of parsed.data.mcp) {
    if (m.kind === "url" && !m.url) return Response.json({ error: `Server „${m.label}“ nemá URL.` }, { status: 400 });
    if (m.kind === "connector" && !m.connectorId) return Response.json({ error: `Server „${m.label}“ nemá vybraný konektor.` }, { status: 400 });
  }
  if (new Set(parsed.data.mcp.map((m) => m.id)).size !== parsed.data.mcp.length) {
    return Response.json({ error: "Dva servery mají stejné ID." }, { status: 400 });
  }

  await writeSettings(parsed.data);
  return Response.json(publicSettings(parsed.data));
}
