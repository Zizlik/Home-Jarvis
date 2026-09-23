import { cleanCard, reviseCard } from "@/lib/normalize";

export const runtime = "nodejs";

/**
 * Card text from speech, with Gemini:
 * - `{ card, change }`: apply a spoken change ("posuň to na sobotu") to the shown card;
 * - `{ utterance }`: tidy a long, messy dictation into card text.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { card?: unknown; change?: unknown; utterance?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 1000) : "");
  const [card, change, utterance] = [str(body?.card), str(body?.change), str(body?.utterance)];
  if (!(card && change) && !utterance) return Response.json({ error: "Chybí text." }, { status: 400 });
  try {
    const text = utterance ? await cleanCard(utterance, request.signal) : await reviseCard(card, change, request.signal);
    return text ? Response.json({ text }) : Response.json({ error: "Text se nepodařilo upravit." }, { status: 502 });
  } catch (err) {
    console.warn(`[card] failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ error: "Text se nepodařilo upravit." }, { status: 502 });
  }
}
