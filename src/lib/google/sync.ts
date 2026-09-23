import "server-only";
import { google } from "./auth";

/**
 * Saved cards → Google. The browser parses the card (its time zone, its parsers)
 * and sends plain fields; this writes them and returns where they went.
 */

export type SyncCard =
  | { kind: "event"; title: string; start: string; end?: string | null; allDay: boolean; description?: string; location?: string | null }
  | { kind: "task"; title: string; due?: string | null; notes?: string }
  | { kind: "tasklist"; title: string; items: string[] }
  | { kind: "keep-note"; title: string; text: string }
  | { kind: "keep-list"; title: string; items: string[] };

/** Where a card was written, so it can be removed or replaced later. */
export type SyncRef = { target: "calendar" | "tasks" | "keep"; id: string; parentIds?: string[]; url?: string };

const TZ = "Europe/Prague";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
const KEEP = "https://keep.googleapis.com/v1/notes";

const day = (iso: string) => iso.slice(0, 10);
const plusHour = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString();
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export async function create(card: SyncCard): Promise<SyncRef> {
  switch (card.kind) {
    case "event": {
      const body = card.allDay
        ? { start: { date: day(card.start) }, end: { date: nextDay(day(card.end ?? card.start)) } }
        : { start: { dateTime: card.start, timeZone: TZ }, end: { dateTime: card.end ?? plusHour(card.start), timeZone: TZ } };
      const ev = await google<{ id: string; htmlLink: string }>(CAL, {
        method: "POST",
        body: JSON.stringify({ summary: card.title, description: card.description, location: card.location ?? undefined, ...body }),
      });
      return { target: "calendar", id: ev.id, url: ev.htmlLink };
    }
    case "task": {
      // Google Tasks keeps only the date of `due`; the time goes to the notes.
      const t = await google<{ id: string; webViewLink?: string }>(TASKS, {
        method: "POST",
        body: JSON.stringify({ title: card.title, notes: card.notes, due: card.due ? `${day(card.due)}T00:00:00.000Z` : undefined }),
      });
      return { target: "tasks", id: t.id, url: t.webViewLink };
    }
    case "tasklist": {
      // One task per list, its items as subtasks.
      const parent = await google<{ id: string; webViewLink?: string }>(TASKS, { method: "POST", body: JSON.stringify({ title: card.title }) });
      const ids: string[] = [];
      let previous: string | undefined;
      for (const item of card.items) {
        const q = new URLSearchParams({ parent: parent.id, ...(previous ? { previous } : {}) });
        const t = await google<{ id: string }>(`${TASKS}?${q}`, { method: "POST", body: JSON.stringify({ title: item }) });
        ids.push(t.id);
        previous = t.id;
      }
      return { target: "tasks", id: parent.id, parentIds: ids, url: parent.webViewLink };
    }
    case "keep-note":
    case "keep-list": {
      const body =
        card.kind === "keep-note"
          ? { text: { text: card.text } }
          : { list: { listItems: card.items.map((t) => ({ text: { text: t }, checked: false })) } };
      const n = await google<{ name: string }>(KEEP, { method: "POST", body: JSON.stringify({ title: card.title, body }) });
      return { target: "keep", id: n.name };
    }
  }
}

export async function remove(ref: SyncRef): Promise<void> {
  const gone = (err: unknown) => {
    // Already deleted in Google: fine.
    if (err instanceof Error && /not found|deleted|404|410/i.test(err.message)) return;
    throw err;
  };
  switch (ref.target) {
    case "calendar":
      return google<void>(`${CAL}/${encodeURIComponent(ref.id)}`, { method: "DELETE" }).catch(gone);
    case "tasks":
      for (const id of [...(ref.parentIds ?? []), ref.id]) await google<void>(`${TASKS}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(gone);
      return;
    case "keep":
      return google<void>(`https://keep.googleapis.com/v1/${ref.id}`, { method: "DELETE" }).catch(gone);
  }
}
