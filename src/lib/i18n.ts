import { format } from "date-fns";
import { cs } from "date-fns/locale";

export const LOCALE = "cs-CZ";

/**
 * Czech plural: 1 den / 2–4 dny / 5+ dní (and 0, decimals → "many").
 * plural(n, "den", "dny", "dní")
 */
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n);
  if (!Number.isInteger(a)) return few;
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/** `n` followed by the right plural form, e.g. "3 dny". */
export const count = (n: number, one: string, few: string, many: string) => `${n.toLocaleString(LOCALE)} ${plural(n, one, few, many)}`;

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** date-fns format with the Czech locale. */
export const formatCs = (date: Date, pattern: string) => format(date, pattern, { locale: cs });

export const formatNumber = (n: number, options?: Intl.NumberFormatOptions) => n.toLocaleString(LOCALE, options);

/** 24h clock in a given IANA zone, e.g. "15:00". */
export function formatTimeIn(tz: string, at: Date) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** Czech names for the few unit labels that are English words; the rest are symbols. */
const UNIT_CS: Record<string, string> = { cup: "hrnek", tsp: "lžička", Tbs: "lžíce", pnt: "pinta", knot: "uzel", t: "US tuna" };

export const unitLabel = (unit: string, labels: Record<string, string>) => UNIT_CS[unit] ?? labels[unit] ?? unit;
