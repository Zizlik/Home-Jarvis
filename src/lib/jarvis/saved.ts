import type { SavedItem } from "@/lib/savedItems";

/**
 * Which card does "smaž tu večeři" / "přesuň oběd s Janou na pátek" mean?
 * Words of the request are matched to words of each card by their first four
 * letters, which copes with Czech endings (večeři ~ večeře, Janou ~ Jana).
 */

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Command and filler words that say nothing about which card.
const STOP = new Set(
  "smaz smazat smazte zrus zrusit zahod zahodit odstran odstranit vymaz vymazat uprav upravit zmen zmenit posun posunout presun presunout dej prepis prepsat oprav opravit ulozenou ulozeny ulozene ulozenych kartu karta karty tu ten tuhle tenhle tamtu tamten to ta tam prosim jarvisi jarvis hey hej taky jeste mi si na do ze se pro od za by bych chci potrebuju muzes ale a i nebo misto".split(" "),
);

const words = (s: string) =>
  plain(s)
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));

const stem = (w: string) => (/^\d+$/.test(w) ? w : w.slice(0, 4));

/** How many of the request's content words appear in the text (0 = none). */
export function overlap(request: string, text: string) {
  const have = new Set(words(text).map(stem));
  return words(request).filter((w) => have.has(stem(w))).length;
}

/** The request mentions something concrete (not just "smaž to"). */
export const hasContent = (request: string) => words(request).length > 0;

const LATEST = /poslední|posledni|předchozí|predchozi|naposledy|nejnovější|nejnovejsi/i;

/** What people call each kind of card ("smaž ten nákup" → a list). */
const KIND_WORDS: Record<string, string> = {
  event: "událost schůzka schůzku akce termín",
  reminder: "připomínka připomínku připomenutí",
  todo: "seznam nákup nákupní úkoly",
  timer: "časovač minutka",
  habit: "návyk zvyk",
  color: "barva barvu",
  split: "rozdělení účet",
  expense: "výdaj útrata platba",
  convert: "převod",
  calc: "výpočet příklad",
  travel: "cesta cestu výlet let",
  poll: "anketa anketu hlasování",
  contact: "kontakt číslo",
  link: "odkaz záložka záložku",
  countdown: "odpočet",
  timezone: "čas pásmo",
  random: "los",
  goal: "cíl",
  note: "poznámka poznámku zápis",
};

/** The saved card the request points at, or null. Ties go to the newest card. */
export function findSaved(request: string, list: SavedItem[]): { item: SavedItem; score: number } | null {
  if (!list.length) return null;
  if (LATEST.test(request) && words(request).every((w) => LATEST.test(w))) return { item: list[0], score: 1 };
  let best: { item: SavedItem; score: number } | null = null;
  for (const item of list) {
    const score = overlap(request, `${item.text} ${item.summary} ${KIND_WORDS[item.intent] ?? ""}`);
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best;
}
