import { LRU } from "@/lib/lru";

export const runtime = "nodejs";

/** Mic sessions per client IP per minute: the key costs money, the page is public. */
const LIMIT = 10;
const hits = new LRU<string, number[]>(1000);

const PROMPTS = {
  notes:
    "Krátké české poznámky do diáře: schůzky, připomínky, nákupní seznamy, časovače, návyky, částky v Kč, převody jednotek, časová pásma. Čísla piš číslicemi.",
  meeting: "Pracovní meeting v češtině, občas anglické termíny. Více mluvčích. Zachovej jména, čísla, částky a termíny. Čísla piš číslicemi.",
};

const session = (mode: keyof typeof PROMPTS) => ({
  expires_after: { anchor: "created_at", seconds: 60 },
  session: {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-live-transcribe",
          languages: ["cs", "en"],
          prompt: PROMPTS[mode],
        },
        // A meeting mic sits on the table, dictation is held close.
        noise_reduction: { type: mode === "meeting" ? "far_field" : "near_field" },
        turn_detection: null,
      },
    },
  },
});

/** Mints a short-lived client secret so the browser can stream the mic straight to OpenAI. */
export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return Response.json({ error: "Mikrofon není nastavený (chybí OPENAI_API_KEY)." }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= LIMIT) return Response.json({ error: "Moc pokusů, zkus to za chvíli." }, { status: 429 });
  hits.set(ip, [...recent, now]);

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(session(new URL(request.url).searchParams.get("mode") === "meeting" ? "meeting" : "notes")),
    signal: AbortSignal.timeout(5000),
  }).catch((err: unknown) => err as Error);
  if (res instanceof Error || !res.ok) {
    const detail = res instanceof Error ? res.message : `${res.status} ${(await res.text()).slice(0, 200)}`;
    console.warn(`[voice] client secret failed: ${detail}`);
    return Response.json({ error: "Nepodařilo se spustit mikrofon." }, { status: 502 });
  }
  const data = (await res.json()) as { value: string };
  return Response.json({ secret: data.value });
}
