import { registry } from "@/components/intents/registry";
import { parseTextFor } from "@/lib/cs";
import { type CardIntent, type IntentResult, intentResultSchema } from "@/lib/jev/types";
import { parseFor } from "@/lib/parse";

export type Card = { text: string; intent: CardIntent; label: string; summary: string; confidence: number };

/** Jev picks the card, the Czech rules and parsers fill it in: the same pipeline as typing. */
export async function buildCard(text: string): Promise<Card | null> {
  const res = await fetch("/api/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  const parsed = intentResultSchema.safeParse(await res.json());
  if (!parsed.success) return null;
  const r: IntentResult = parsed.data;
  const intent = r.intent.value === "none" ? "note" : r.intent.value;
  const data = parseFor(intent, parseTextFor(intent, text));
  const def = registry[intent];
  return { text, intent, label: def.label, summary: (def.summary as (d: typeof data) => string)(data), confidence: r.intent.confidence };
}

/** What the backend model gets back: enough for one spoken sentence, nothing to invent. */
export function describe(card: Card) {
  return { karta: card.label, obsah: card.summary };
}
