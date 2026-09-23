import { rejectForeignOrigin } from "@/app/api/settings/origin";
import { account, google } from "@/lib/google/auth";
import { keepToken } from "@/lib/google/keep";
import { actionText } from "@/lib/meeting/minutes";
import { listMeetings } from "@/lib/meeting/store";

export const runtime = "nodejs";

/**
 * Common questions answered straight from the data, no model in between:
 * Jev said what the question is about, the browser worked out the period, and
 * this returns plain Czech facts for Jarvis to say (~0.5 s instead of 3–5 s).
 */

const TZ = "Europe/Prague";
const dayLabel = (d: Date) => d.toLocaleDateString("cs-CZ", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
const hm = (d: Date) => d.toLocaleTimeString("cs-CZ", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

type Ev = { summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };
type Task = { id: string; title?: string; status?: string; due?: string; completed?: string; parent?: string };
type Note = { trashed?: boolean; title?: string; body?: { text?: { text?: string }; list?: { listItems?: { text?: { text?: string }; checked?: boolean }[] } } };

async function calendar(from: string, to: string) {
  const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "20", timeZone: TZ });
  const r = await google<{ items?: Ev[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  const items = r.items ?? [];
  if (!items.length) {
    const [a, b] = [dayLabel(new Date(from)), dayLabel(new Date(Date.parse(to) - 1))];
    return a === b ? `Na ${a} nemáš v kalendáři nic.` : `Od ${a} do ${b} nemáš v kalendáři nic.`;
  }
  const byDay = new Map<string, string[]>();
  for (const e of items) {
    const start = new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00`);
    const when = e.start?.dateTime ? `${hm(start)}–${hm(new Date(e.end?.dateTime ?? start))}` : "celý den";
    const line = `${when} ${e.summary ?? "(bez názvu)"}${e.location ? ` (${e.location})` : ""}`;
    const key = dayLabel(start);
    byDay.set(key, [...(byDay.get(key) ?? []), line]);
  }
  return [...byDay].map(([d, lines]) => `${d}: ${lines.join("; ")}`).join("\n");
}

async function tasks(completed: boolean) {
  const r = await google<{ items?: Task[] }>(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=${completed}&showHidden=${completed}&maxResults=100`);
  const items = (r.items ?? []).filter((t) => (completed ? t.status === "completed" : t.status !== "completed"));
  if (!items.length) return completed ? "Žádné splněné úkoly." : "Nemáš žádné nesplněné úkoly.";
  const title = new Map((r.items ?? []).map((t) => [t.id, t.title]));
  const lines = items
    .slice(0, 15)
    .map((t) => `${t.title}${t.parent ? ` (v seznamu ${title.get(t.parent)})` : ""}${t.due ? `, termín ${new Date(t.due).toLocaleDateString("cs-CZ", { timeZone: "UTC" })}` : ""}`);
  return `${completed ? "Splněné" : "Nesplněné"} úkoly (${items.length}): ${lines.join("; ")}.`;
}

async function notes() {
  const user = await account();
  const token = user ? await keepToken(user).catch(() => null) : null;
  if (!token) return null;
  const r = await google<{ notes?: Note[] }>("https://keep.googleapis.com/v1/notes?pageSize=30", {}, token);
  const list = (r.notes ?? []).filter((n) => !n.trashed).slice(0, 8);
  if (!list.length) return "V Google Keep nemáš žádné poznámky.";
  return list
    .map((n) => {
      const items = n.body?.list?.listItems;
      if (items) {
        const open = items.filter((i) => !i.checked).map((i) => i.text?.text).filter(Boolean);
        return `${n.title || "Seznam"}: ${open.length ? `nezaškrtnuté ${open.join(", ")}` : "vše zaškrtnuté"}`;
      }
      return `${n.title || "Poznámka"}: ${(n.body?.text?.text ?? "").slice(0, 120)}`;
    })
    .join("\n");
}

async function lastMeeting() {
  const m = (await listMeetings())[0];
  if (!m) return "Zatím nemáš nahraný žádný meeting.";
  const when = new Date(m.startedAt).toLocaleString("cs-CZ", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
  const parts = [
    `Poslední meeting ${when}: ${m.title || m.minutes.title}${m.participants.length ? `, účastníci ${m.participants.join(", ")}` : ""}.`,
    m.minutes.overview || m.minutes.summary.slice(0, 5).join(" "),
    m.minutes.decisions.length ? `Rozhodnutí: ${m.minutes.decisions.join("; ")}.` : "",
    m.minutes.actions.length ? `Úkoly: ${m.minutes.actions.map(actionText).join("; ")}.` : "",
    m.minutes.questions.length ? `Otevřené: ${m.minutes.questions.join("; ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export async function POST(request: Request) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;
  const b = (await request.json().catch(() => null)) as { topic?: string; from?: string; to?: string; completed?: boolean } | null;
  const started = performance.now();
  try {
    let facts: string | null = null;
    if (b?.topic === "meetings") facts = await lastMeeting();
    else if (!(await account())) facts = null;
    else if (b?.topic === "calendar" && b.from && b.to) facts = await calendar(b.from, b.to);
    else if (b?.topic === "tasks") facts = await tasks(!!b.completed);
    else if (b?.topic === "notes") facts = await notes();
    if (!facts) return Response.json({ facts: null });
    console.info(`[quick] ${b?.topic} ${Math.round(performance.now() - started)}ms`);
    return Response.json({ facts });
  } catch (err) {
    console.warn(`[quick] ${b?.topic} failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ facts: null });
  }
}
