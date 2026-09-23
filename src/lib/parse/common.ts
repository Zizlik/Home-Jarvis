import * as chrono from "chrono-node";

export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => capitalize(w))
    .join(" ");

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Strip dangling connector words left behind after removing a phrase. */
export function tidy(s: string) {
  let out = collapse(s.replace(/[,;]+\s*$/g, "").replace(/^\s*[,;:-]+/g, ""));
  const dangling = /\s+(on|at|by|for|with|to|in|and|the|this|next|from|every|a|s|se|v|ve|na|do|za|k|ke|pro|od|u|o)$/i;
  const leading = /^(on|at|by|for|and|the|to|a|v|ve|na|do|za|pro)\s+/i;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(dangling, "").replace(leading, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

export type Currency = "Kč" | "₹" | "$" | "€" | "£";
export const DEFAULT_CURRENCY: Currency = "Kč";

export function detectCurrency(text: string): Currency {
  if (/\$|\busd\b|dollars?\b/i.test(text)) return "$";
  if (/€|\beur(os?)?\b/i.test(text)) return "€";
  if (/£|\bgbp\b|pounds? sterling/i.test(text)) return "£";
  if (/₹|\b(?:inr|rs\.?|rupees?)(?=\s|$|\d)/i.test(text)) return "₹";
  return DEFAULT_CURRENCY;
}

export const AMOUNT_RE = /(?:₹|rs\.?|inr|\$|€|£)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k(?![\wčČ])|tis(?:íc)?\.?(?=\s|$))?/i;

export function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/** Find the first money-like amount in the text. */
export function findAmount(text: string): { value: number; index: number; length: number } | null {
  const re = new RegExp(AMOUNT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = toNumber(m[1]);
    if (!Number.isFinite(n)) continue;
    return { value: m[2] ? n * 1000 : n, index: m.index, length: m[0].length };
  }
  return null;
}

export type DateHit = {
  start: Date;
  end: Date | null;
  hasTime: boolean;
  text: string;
  index: number;
};

export function findDate(text: string, ref: Date = new Date()): DateHit | null {
  const results = chrono.parse(text, ref, { forwardDate: true });
  if (!results.length) return null;
  const r = results[0];
  // chrono is happy to read a bare number as a date; require something date-like.
  if (/^\d+$/.test(r.text.trim())) return null;
  return {
    start: r.start.date(),
    end: r.end ? r.end.date() : null,
    hasTime: r.start.isCertain("hour"),
    text: r.text,
    index: r.index,
  };
}

export function removeRange(text: string, index: number, length: number) {
  return text.slice(0, index) + " " + text.slice(index + length);
}

export function formatAmount(n: number, currency: Currency = DEFAULT_CURRENCY) {
  const rounded = Math.round(n * 100) / 100;
  const num = rounded.toLocaleString("cs-CZ", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  // Czech style: the symbol follows the number ("800 Kč", "25 €").
  return `${num}\u00a0${currency}`;
}
