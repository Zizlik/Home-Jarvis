import type { CardIntent } from "@/lib/jev/types";
import { completenessFor } from "@/lib/parse";
import { looksCzech, rewriteCzech, TYPED_TEXT } from "./rewrite";

export { looksCzech, rewriteCzech, TYPED_TEXT };

/**
 * The text a card's parser reads: the built-in Czech rewrite, or Gemini's
 * rewrite when it fills the card in better.
 */
export function parseTextFor(intent: CardIntent, text: string, gemini?: string | null): string {
  const local = rewriteCzech(text, intent);
  if (!gemini || TYPED_TEXT.has(intent)) return local;
  return completenessFor(intent, gemini) > completenessFor(intent, local) ? gemini : local;
}

/** Ask Gemini only when the built-in rules leave a Czech card mostly empty. */
export function needsFallback(intent: CardIntent | null, text: string): boolean {
  if (!intent || TYPED_TEXT.has(intent) || !looksCzech(text)) return false;
  return completenessFor(intent, rewriteCzech(text, intent)) < 0.6;
}
