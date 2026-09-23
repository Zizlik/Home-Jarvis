import { parseTextFor } from "@/lib/cs";
import type { SavedItem } from "@/lib/savedItems";
import { parseFor } from "@/lib/parse";
import type { EventData } from "@/lib/parse/event";
import type { NoteData } from "@/lib/parse/note";
import type { ReminderData } from "@/lib/parse/reminder";
import type { TodoData } from "@/lib/parse/todo";

/** Mirrors lib/settings.ts GoogleSync (that module is server-only). */
export type GoogleSyncPrefs = { event: boolean; reminder: boolean; todo: "tasks" | "keep" | "off"; note: "keep" | "off" };

/** Mirrors lib/google/sync.ts SyncCard. */
export type SyncCard =
  | { kind: "event"; title: string; start: string; end?: string | null; allDay: boolean; description?: string; location?: string | null }
  | { kind: "task"; title: string; due?: string | null; notes?: string }
  | { kind: "tasklist"; title: string; items: string[] }
  | { kind: "keep-note"; title: string; text: string }
  | { kind: "keep-list"; title: string; items: string[] };

const time = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });

/** A date with its local offset ("2026-09-26T20:00:00+02:00"), so Google gets the wall time the user meant. */
function isoLocal(d: Date) {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

/**
 * What to write to Google for a saved card, parsed here so dates use the
 * browser's time zone. `{ skip }` explains why a card isn't written.
 */
export function toGoogle(item: SavedItem, prefs: GoogleSyncPrefs): SyncCard | { skip: string } | null {
  const data = parseFor(item.intent, parseTextFor(item.intent, item.text));
  const from = `Z Jarvise: „${item.text}“`;
  switch (item.intent) {
    case "event": {
      if (!prefs.event) return null;
      const e = data as EventData;
      if (!e.date) return { skip: "Chybí datum, do kalendáře se nezapsalo." };
      const details = [e.people.length ? `S: ${e.people.join(", ")}` : "", e.link ? `Přes: ${e.link}` : "", from].filter(Boolean);
      return { kind: "event", title: e.title || item.summary, start: isoLocal(e.date), allDay: !e.hasTime, description: details.join("\n"), location: e.location };
    }
    case "reminder": {
      if (!prefs.reminder) return null;
      const r = data as ReminderData;
      const notes = [r.when && r.hasTime ? `V ${time(r.when)}` : "", from].filter(Boolean).join("\n");
      return { kind: "task", title: r.task || item.summary, due: r.when ? isoLocal(r.when) : null, notes };
    }
    case "todo": {
      if (prefs.todo === "off") return null;
      const t = data as TodoData;
      if (!t.items.length) return null;
      const title = t.title ?? "Seznam";
      return prefs.todo === "keep" ? { kind: "keep-list", title, items: t.items } : { kind: "tasklist", title, items: t.items };
    }
    case "note": {
      if (prefs.note === "off") return null;
      const n = data as NoteData;
      return { kind: "keep-note", title: n.body ? n.title : "", text: n.body || n.title || item.text };
    }
    default:
      return null;
  }
}
