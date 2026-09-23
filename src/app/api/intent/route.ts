import { APIUserAbortError, classifierMode, classifyWithJev, warnMockOnce } from "@/lib/jev/client";
import { mockClassify } from "@/lib/jev/mock";
import { type IntentResult, intentRequestSchema, noneResult } from "@/lib/jev/types";
import { LRU, normalizeKey } from "@/lib/lru";
import { rewriteCzech } from "@/lib/cs/rewrite";

export const runtime = "nodejs";

const cache = new LRU<string, IntentResult>(500);

export async function POST(request: Request) {
  const body = intentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Expected { text: string }" }, { status: 400 });

  const text = body.data.text;
  const context = body.data.context?.trim() || undefined;
  const key = normalizeKey(context ? `${context}\n${text}` : text);
  if (key.length < 2) return Response.json(noneResult({ model: "none" }));

  const hit = cache.get(key);
  if (hit) return Response.json({ ...hit, latencyMs: 0, cached: true } satisfies IntentResult);

  const { mode, reason } = classifierMode();
  if (mode === "offline") {
    warnMockOnce(reason);
    // The keyword classifier only knows English: give it the built-in Czech rewrite.
    return Response.json(mockClassify(rewriteCzech(text)));
  }

  try {
    const result = await classifyWithJev(text, request.signal, context);
    console.info(`[jev] ${result.model} ${result.latencyMs}ms ${result.questionCount}q "${key.slice(0, 40)}" → ${result.intent.value}`);
    cache.set(key, result);
    return Response.json(result);
  } catch (err) {
    if (err instanceof APIUserAbortError || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const status = typeof err === "object" && err && "status" in err ? (err as { status: number }).status : undefined;
    console.warn(`[jev] call failed${status ? ` (${status})` : ""}: ${err instanceof Error ? err.message : String(err)}`);
    // The client falls back to the mock for this keystroke; the UI never flashes.
    return Response.json(noneResult({ error: true, model: "error" }));
  }
}
