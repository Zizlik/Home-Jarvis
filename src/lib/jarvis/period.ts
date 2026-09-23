import { rewriteCzech } from "@/lib/cs/rewrite";
import { findDate } from "@/lib/parse/common";

/**
 * The time window a question means ("zítra", "v pátek odpoledne", "tento týden"),
 * read with the Czech rules and chrono, in the browser's time zone.
 * Without one: from now to a week ahead.
 */
export function periodFor(question: string, now = new Date()): { from: Date; to: Date } {
  const t = rewriteCzech(question, "event").toLowerCase();
  const day = (d: Date, h = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours());
  const mondayOf = (d: Date) => addDays(day(d), -((d.getDay() + 6) % 7));

  if (/next week|příští týden/.test(t)) {
    const mon = addDays(mondayOf(now), 7);
    return { from: mon, to: addDays(mon, 7) };
  }
  if (/this week|week|týden/.test(t)) return { from: now, to: addDays(mondayOf(now), 7) };
  if (/next month|příští měsíc/.test(t)) return { from: new Date(now.getFullYear(), now.getMonth() + 1, 1), to: new Date(now.getFullYear(), now.getMonth() + 2, 1) };
  if (/month|měsíc/.test(t)) return { from: now, to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };

  const hit = findDate(t, now);
  const base = hit ? day(hit.start) : /tonight|today/.test(t) ? day(now) : null;
  if (!base) return { from: now, to: addDays(now, 7) };
  // Part of the day narrows it down: "v pátek odpoledne".
  if (/morning/.test(t)) return { from: day(base, 5), to: day(base, 12) };
  if (/afternoon/.test(t)) return { from: day(base, 12), to: day(base, 18) };
  if (/evening|tonight|night/.test(t)) return { from: day(base, 17), to: day(addDays(base, 1)) };
  const from = day(base).getTime() === day(now).getTime() ? now : day(base);
  return { from, to: day(addDays(base, 1)) };
}
