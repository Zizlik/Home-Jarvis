import OpenAI from "openai";
import { sessionConfig } from "@/lib/jarvis/config";
import { LRU } from "@/lib/lru";
import { readSettings, VOICES } from "@/lib/settings";

export const runtime = "nodejs";

/** Voice sessions per client IP per minute: they cost money. */
const LIMIT = 6;
const hits = new LRU<string, number[]>(1000);
let client: OpenAI | null = null;

/** Exchanges the browser's SDP offer for a GPT-Live session. The API key stays here. */
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Chybí OPENAI_API_KEY." }, { status: 503 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: "Neočekávaný původ požadavku." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { sdp?: unknown; voice?: unknown } | null;
  if (typeof body?.sdp !== "string" || !body.sdp.trim() || body.sdp.length > 64_000) {
    return Response.json({ error: "Chybí SDP nabídka." }, { status: 400 });
  }
  // ?voice= in the URL wins over the saved setting, for trying voices out.
  const voice = typeof body.voice === "string" && (VOICES as readonly string[]).includes(body.voice) ? body.voice : (await readSettings()).voice;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= LIMIT) return Response.json({ error: "Moc pokusů, zkus to za chvíli." }, { status: 429 });
  hits.set(ip, [...recent, now]);

  client ??= new OpenAI({ maxRetries: 0 });
  try {
    const result = await client.live.create({ session: sessionConfig(voice), transport: { type: "webrtc", sdp: body.sdp } });
    console.info(`[live] session ${result.session.id} voice=${voice}`);
    return Response.json(result, { status: 201 });
  } catch (err) {
    const status = err instanceof OpenAI.APIError ? (err.status ?? 502) : 502;
    console.warn(`[live] session failed (${status}): ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Nepodařilo se spustit Jarvise." }, { status });
  }
}
