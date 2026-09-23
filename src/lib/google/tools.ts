import "server-only";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { account, google } from "./auth";
import { keepToken } from "./keep";
import { minutesText, transcriptText } from "@/lib/meeting/minutes";
import { listMeetings } from "@/lib/meeting/store";

/**
 * Google as function tools for the question agent (/api/agent): read the calendar,
 * Gmail and Tasks, and send an email only after the user says yes.
 */

const TZ = "Europe/Prague";
const str = (description: string) => ({ type: "string", description });

/** Meeting archive (data/meetings): works without Google. */
export const MEETING_TOOLS: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "meeting_notes",
    description: "Zápisy z minulých meetingů nahraných v Jarvisovi (nejnovější první), případně jen ty, které obsahují hledaný text.",
    strict: true,
    parameters: { type: "object", properties: { query: { type: ["string", "null"], description: "Hledaný text, nebo null" } }, required: ["query"], additionalProperties: false },
  },
];

export const GOOGLE_TOOLS: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "calendar_events",
    description: "Události z Google Kalendáře uživatele v daném období.",
    strict: true,
    parameters: {
      type: "object",
      properties: { from: str("Začátek období, ISO 8601 s časovou zónou"), to: str("Konec období, ISO 8601 s časovou zónou"), query: { type: ["string", "null"], description: "Hledaný text, nebo null" } },
      required: ["from", "to", "query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "gmail_search",
    description: "Hledá e-maily v Gmailu uživatele. Dotaz v syntaxi Gmailu, např. 'from:petr newer_than:7d' nebo 'is:unread'.",
    strict: true,
    parameters: { type: "object", properties: { query: str("Dotaz v syntaxi vyhledávání Gmailu") }, required: ["query"], additionalProperties: false },
  },
  {
    type: "function",
    name: "tasks_list",
    description: "Úkoly uživatele v Google Tasks: nesplněné, nebo i splněné (s datem splnění). Podúkoly patří k nadřazenému úkolu (seznamy z Jarvise).",
    strict: true,
    parameters: {
      type: "object",
      properties: { include_completed: { type: "boolean", description: "true = i splněné úkoly" } },
      required: ["include_completed"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "tasks_complete",
    description: "Označí úkol v Google Tasks jako splněný (nebo vrátí jako nesplněný). Hledá podle názvu.",
    strict: true,
    parameters: {
      type: "object",
      properties: { title: str("Název nebo část názvu úkolu"), done: { type: "boolean", description: "true = splněno, false = vrátit jako nesplněné" } },
      required: ["title", "done"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "keep_notes",
    description: "Poznámky a seznamy uživatele v Google Keep, u seznamů i které položky jsou zaškrtnuté.",
    strict: true,
    parameters: { type: "object", properties: { query: { type: ["string", "null"], description: "Hledaný text v názvu nebo obsahu, nebo null" } }, required: ["query"], additionalProperties: false },
  },
  {
    type: "function",
    name: "delete_prepare",
    description:
      "Najde události v kalendáři nebo úkoly v Tasks, které chce uživatel smazat. Nic nesmaže: vrátí id a seznam. Seznam uživateli přečti a zeptej se, jestli je opravdu smazat.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        what: { type: "string", enum: ["calendar", "tasks"], description: "calendar = události, tasks = úkoly" },
        from: { type: ["string", "null"], description: "Kalendář: začátek období (ISO 8601 s časovou zónou), jinak null" },
        to: { type: ["string", "null"], description: "Kalendář: konec období (ISO 8601 s časovou zónou), jinak null" },
        query: { type: ["string", "null"], description: "Hledaný text v názvu (např. „porada“), nebo null pro všechno v období" },
      },
      required: ["what", "from", "to", "query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_confirmed",
    description: "Smaže dříve připravené položky. Jen když uživatel v POSLEDNÍ větě výslovně potvrdil smazání.",
    strict: true,
    parameters: { type: "object", properties: { delete_id: str("Id z delete_prepare") }, required: ["delete_id"], additionalProperties: false },
  },
  {
    type: "function",
    name: "gmail_prepare",
    description: "Připraví e-mail k odeslání. Nic neodešle: vrátí id konceptu. Obsah přečti uživateli a zeptej se, jestli ho má odeslat.",
    strict: true,
    parameters: {
      type: "object",
      properties: { to: str("E-mailová adresa příjemce"), subject: str("Předmět"), body: str("Text e-mailu, česky, podepsat se nemusíš") },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "gmail_send",
    description: "Odešle dříve připravený e-mail. Jen když uživatel v POSLEDNÍ větě výslovně potvrdil odeslání.",
    strict: true,
    parameters: { type: "object", properties: { draft_id: str("Id z gmail_prepare") }, required: ["draft_id"], additionalProperties: false },
  },
];

type Task = { id: string; title?: string; status?: string; completed?: string; due?: string; parent?: string };
type KeepNote = { trashed?: boolean; title?: string; updateTime?: string; body?: { text?: { text?: string }; list?: { listItems?: { text?: { text?: string }; checked?: boolean }[] } } };
const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";

type Draft = { to: string; subject: string; body: string; at: number };
type PendingDelete = { what: "calendar" | "tasks"; items: { id: string; title: string }[]; at: number };
const deletions = new Map<string, PendingDelete>();
const drafts = new Map<string, Draft>();

/** "ano, pošli to" and friends: the only way a prepared email gets sent. */
const CONFIRM = /(?<![\p{L}])(ano|jo|jasně|jasne|pošli|posli|odešli|odesli|potvrzuj[iu]|potvrď|potvrd|můžeš|muzes|klidně|klidne|souhlasím|souhlasim|smaž|smaz|smazat|vymaž|vymaz|zruš|zrus)(?![\p{L}])/iu;
const DENY = /(?<![\p{L}])(ne|neposílej|neposilej|počkej|pockej|zruš|zrus|stop)(?![\p{L}])/iu;

const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function mime(d: Draft) {
  const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
  const raw = [`To: ${d.to}`, `Subject: ${enc(d.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(d.body, "utf8").toString("base64")].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

/** Runs one tool call. `question` is what the user just said (for the send confirmation). */
export async function runGoogleTool(name: string, args: Record<string, unknown>, question: string): Promise<unknown> {
  switch (name) {
    case "calendar_events": {
      const q = new URLSearchParams({ timeMin: String(args.from), timeMax: String(args.to), singleEvents: "true", orderBy: "startTime", maxResults: "25", timeZone: TZ });
      if (typeof args.query === "string" && args.query) q.set("q", args.query);
      const r = await google<{ items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`,
      );
      return (r.items ?? []).map((e) => ({ název: e.summary ?? "(bez názvu)", začátek: e.start?.dateTime ?? e.start?.date, konec: e.end?.dateTime ?? e.end?.date, místo: e.location }));
    }
    case "gmail_search": {
      const list = await google<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: String(args.query), maxResults: "6" })}`);
      return Promise.all(
        (list.messages ?? []).map(async ({ id }) => {
          const m = await google<{ snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          );
          return { od: header(m, "From"), předmět: header(m, "Subject"), datum: header(m, "Date"), úryvek: m.snippet };
        }),
      );
    }
    case "tasks_list": {
      const all = args.include_completed === true;
      const q = new URLSearchParams({ showCompleted: String(all), showHidden: String(all), maxResults: "100" });
      const r = await google<{ items?: Task[] }>(`${TASKS}?${q}`);
      const items = r.items ?? [];
      const title = new Map(items.map((t) => [t.id, t.title]));
      return items.map((t) => ({
        úkol: t.title,
        stav: t.status === "completed" ? "splněno" : "nesplněno",
        splněno: t.completed?.slice(0, 10),
        termín: t.due?.slice(0, 10),
        v_seznamu: t.parent ? title.get(t.parent) : undefined,
      }));
    }
    case "tasks_complete": {
      const want = String(args.title).toLowerCase();
      const done = args.done !== false;
      const r = await google<{ items?: Task[] }>(`${TASKS}?showCompleted=true&showHidden=true&maxResults=100`);
      const candidates = (r.items ?? []).filter((t) => t.title?.toLowerCase().includes(want) && (t.status === "completed") !== done);
      if (!candidates.length) return { chyba: `Úkol „${args.title}“ ${done ? "mezi nesplněnými" : "mezi splněnými"} není.` };
      if (candidates.length > 1) return { chyba: "Víc úkolů odpovídá, upřesni který.", možnosti: candidates.map((t) => t.title) };
      const t = candidates[0];
      await google(`${TASKS}/${encodeURIComponent(t.id)}`, { method: "PATCH", body: JSON.stringify(done ? { status: "completed" } : { status: "needsAction", completed: null }) });
      return { úkol: t.title, stav: done ? "splněno" : "nesplněno" };
    }
    case "keep_notes": {
      const user = await account();
      if (!user) return { chyba: "Google není připojený." };
      const r = await google<{ notes?: KeepNote[] }>("https://keep.googleapis.com/v1/notes?pageSize=50", {}, await keepToken(user));
      const q = typeof args.query === "string" ? args.query.toLowerCase() : "";
      // The API rejects a trashed filter here, so the bin is dropped in code.
      return (r.notes ?? [])
        .filter((n) => !n.trashed)
        .map((n) => ({
          název: n.title || undefined,
          text: n.body?.text?.text?.slice(0, 500),
          položky: n.body?.list?.listItems?.map((i) => `${i.checked ? "[x]" : "[ ]"} ${i.text?.text ?? ""}`),
          upraveno: n.updateTime?.slice(0, 10),
        }))
        .filter((n) => !q || JSON.stringify(n).toLowerCase().includes(q))
        .slice(0, 20);
    }
    case "delete_prepare": {
      const q = typeof args.query === "string" && args.query.trim() ? args.query.trim().toLowerCase() : null;
      let items: { id: string; title: string; when?: string }[] = [];
      if (args.what === "calendar") {
        if (typeof args.from !== "string" || typeof args.to !== "string") return { chyba: "U kalendáře je potřeba období (from, to)." };
        const p = new URLSearchParams({ timeMin: args.from, timeMax: args.to, singleEvents: "true", orderBy: "startTime", maxResults: "50", timeZone: TZ });
        const r = await google<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string } }[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
        items = (r.items ?? []).map((e) => ({ id: e.id, title: e.summary ?? "(bez názvu)", when: e.start?.dateTime ?? e.start?.date }));
      } else {
        const r = await google<{ items?: Task[] }>(`${TASKS}?showCompleted=false&maxResults=100`);
        items = (r.items ?? []).map((t) => ({ id: t.id, title: t.title ?? "(bez názvu)", when: t.due?.slice(0, 10) }));
      }
      if (q) items = items.filter((i) => i.title.toLowerCase().includes(q));
      if (!items.length) return { nalezeno: 0, zpráva: "Nic takového tam není." };
      const id = randomUUID().slice(0, 8);
      deletions.set(id, { what: args.what as "calendar" | "tasks", items, at: Date.now() });
      return { delete_id: id, stav: "připraveno, NIC NESMAZÁNO", počet: items.length, položky: items.map((i) => ({ název: i.title, kdy: i.when })), další_krok: "přečti uživateli, co smažeš, a zeptej se" };
    }
    case "delete_confirmed": {
      const d = deletions.get(String(args.delete_id));
      if (!d || Date.now() - d.at > 15 * 60_000) return { chyba: "Nic k smazání není připravené nebo to vypršelo, najdi položky znovu." };
      // Enforced here, not left to the model: the user's latest words must say yes.
      if (!CONFIRM.test(question) || DENY.test(question)) return { chyba: "Uživatel smazání výslovně nepotvrdil. Zeptej se ho, jestli to smazat." };
      let done = 0;
      for (const i of d.items) {
        const url = d.what === "calendar" ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(i.id)}` : `${TASKS}/${encodeURIComponent(i.id)}`;
        await google(url, { method: "DELETE" }).then(() => done++).catch(() => undefined);
      }
      deletions.delete(String(args.delete_id));
      return { stav: "smazáno", počet: done, z: d.items.length };
    }
    case "gmail_prepare": {
      const id = randomUUID().slice(0, 8);
      drafts.set(id, { to: String(args.to), subject: String(args.subject), body: String(args.body), at: Date.now() });
      return { draft_id: id, stav: "připraveno, NEODESLÁNO", komu: args.to, předmět: args.subject, text: args.body, další_krok: "přečti uživateli a zeptej se, jestli odeslat" };
    }
    case "gmail_send": {
      const d = drafts.get(String(args.draft_id));
      if (!d || Date.now() - d.at > 15 * 60_000) return { chyba: "Koncept neexistuje nebo vypršel, připrav e-mail znovu." };
      // Enforced here, not left to the model: the user's latest words must say yes.
      if (!CONFIRM.test(question) || DENY.test(question)) return { chyba: "Uživatel odeslání výslovně nepotvrdil. Zeptej se ho, jestli e-mail odeslat." };
      await google("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw: mime(d) }) });
      drafts.delete(String(args.draft_id));
      return { stav: "odesláno", komu: d.to, předmět: d.subject };
    }
    case "meeting_notes": {
      const q = typeof args.query === "string" ? args.query.toLowerCase() : "";
      const all = await listMeetings();
      const hits = all.filter((m) => !q || `${m.title} ${minutesText(m.minutes, "")} ${transcriptText(m)}`.toLowerCase().includes(q)).slice(0, 5);
      return hits.map((m) => ({
        název: m.title,
        začátek: m.startedAt,
        účastníci: m.participants,
        zápis: `${m.minutes.overview}\n${minutesText(m.minutes, new Date(m.startedAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" }))}`.slice(0, 3000),
      }));
    }
    default:
      return { chyba: `Neznámý nástroj ${name}` };
  }
}
