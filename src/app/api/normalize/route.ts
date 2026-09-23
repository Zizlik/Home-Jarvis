import { intentRequestSchema } from "@/lib/jev/types";
import { LRU, normalizeKey } from "@/lib/lru";
import { normalizeCzech } from "@/lib/normalize";

export const runtime = "nodejs";

const cache = new LRU<string, string | null>(500);

/** Czech → parser English. Runs beside /api/intent so the card never waits on it. */
export async function POST(request: Request) {
  const body = intentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Expected { text: string }" }, { status: 400 });

  const text = body.data.text;
  const key = normalizeKey(text);
  if (key.length < 2) return Response.json({ normalizedText: null });

  const hit = cache.get(key);
  if (hit !== undefined) return Response.json({ normalizedText: hit, cached: true });

  try {
    const normalizedText = await normalizeCzech(text, request.signal);
    if (normalizedText && normalizedText !== text) console.info(`[cs] "${text.slice(0, 40)}" → "${normalizedText.slice(0, 60)}"`);
    cache.set(key, normalizedText);
    return Response.json({ normalizedText });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.warn(`[cs] normalize failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ normalizedText: null });
  }
}
