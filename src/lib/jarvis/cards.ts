import { registry } from "@/components/intents/registry";
import { parseTextFor } from "@/lib/cs";
import { type Action, type CardIntent, type IntentResult, intentResultSchema } from "@/lib/jev/types";
import { parseFor } from "@/lib/parse";

export type Card = { text: string; intent: CardIntent; label: string; summary: string; confidence: number };
export type Decision = { action: Action; actionConfidence: number; result: IntentResult };

/** One Jev call answers both "which card" and "what to do". */
export async function classify(text: string, signal?: AbortSignal): Promise<IntentResult | null> {
  const res = await fetch("/api/intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) return null;
  const parsed = intentResultSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

export function decide(result: IntentResult): Decision {
  // Offline (no Jev key) there is no action answer: anything card-like is a new card.
  const action = result.action?.value ?? (result.intent.value === "none" ? "chat" : "create");
  return { action, actionConfidence: result.action?.confidence ?? 0.5, result };
}

// "Jarvisi, prosím tě zapiš mi večeři…" → "večeři…"
const LEAD =
  /^\s*(?:(?:hej|hele|ahoj|čau)\s+)?(?:jarvis(?:i|e)?[,!.]?\s+)?(?:(?:prosím(?:\s+tě)?|prosim(?:\s+te)?|můžeš|muzes|mohl\s+bys|chci|potřebuju)[,]?\s+)?(?:(zapiš|zapis|napiš|napis|poznamenej|přidej|pridej|vytvoř|vytvor|udělej|udelej|dej|nastav|ulož|uloz|založ|zaloz)(?:\s+(?:mi|si|nám|nam))?(?:\s+(?:do\s+kalendáře|do\s+kalendare|do\s+seznamu|poznámku|poznamku))?[:,]?\s+)?/iu;

/** Accusative → nominative for the first word after a stripped command ("večeři" → "večeře", "schůzku" → "schůzka"). */
function nominativeHead(text: string) {
  return text.replace(/^(\p{L}+?)(ři|ci|či|ži|ši|ji|li|ni|u)(?=\s|$)/u, (m, stem: string, end: string) => {
    if (stem.length < 2) return m;
    if (end === "u") return /[aeiouyáéíóúůý]$/i.test(stem) ? m : `${stem}a`;
    return `${stem}${end.slice(0, -1)}e`;
  });
}

/**
 * Where the user said it belongs wins over Jev: "do kalendáře" is an event (Google Calendar),
 * "do úkolů" a reminder (Tasks), "do poznámek / do Keepu" a note (Keep).
 */
const TARGETS: [RegExp, CardIntent][] = [
  [/(?<![\p{L}])(do|v|ve|na)\s+(kalendář\p{L}*|kalendar\p{L}*)|(?<![\p{L}])kalendář(?![\p{L}])/iu, "event"],
  [/(?<![\p{L}])(do|v|ve|mezi)\s+(úkol\p{L}*|ukol\p{L}*|tasks?|to-?do)(?![\p{L}])/iu, "reminder"],
  [/(?<![\p{L}])(do|v|ve|mezi)\s+(poznám\p{L}*|poznam\p{L}*|keep\p{L}*)(?![\p{L}])/iu, "note"],
];
export function targetIntent(utterance: string): CardIntent | null {
  return TARGETS.find(([re]) => re.test(utterance))?.[1] ?? null;
}
const TARGET_WORDS = /\s*(?<![\p{L}])(?:do|v|ve|na|mezi)\s+(?:kalendář\p{L}*|kalendar\p{L}*|úkol\p{L}*|ukol\p{L}*|tasks?|poznám\p{L}*|poznam\p{L}*|keep\p{L}*)(?![\p{L}])/giu;

/** Where a saved card of this kind goes in Google (for Jarvis to say). */
export const DESTINATION: Partial<Record<CardIntent, string>> = { event: "Google Kalendáře", reminder: "Google Tasks", todo: "Google Tasks", note: "Google Keep" };

/** What goes on the card: the utterance without the address and command. */
export function cardText(utterance: string) {
  const m = utterance.match(LEAD);
  const rest = utterance
    .slice(m?.[0].length ?? 0)
    .replace(TARGET_WORDS, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,:]\s*/, "")
    // "…, že si mám zítra vyzvednout balík" → "zítra vyzvednout balík"
    .replace(/^že\s+(?:si\s+|se\s+)?(?:mám|musím|budu|máme|musíme)?\s*/iu, "")
    .replace(/[.!…]+$/u, "");
  return m?.[1] ? nominativeHead(rest) : rest;
}

/** The card Jev picked for the text, filled in by the Czech rules and parsers. */
export function buildCard(text: string, result: IntentResult, intent?: CardIntent): Card {
  const k = intent ?? (result.intent.value === "none" ? "note" : result.intent.value);
  const data = parseFor(k, parseTextFor(k, text));
  const def = registry[k];
  return { text, intent: k, label: def.label, summary: (def.summary as (d: typeof data) => string)(data), confidence: result.intent.confidence };
}
