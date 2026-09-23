import "server-only";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { google } from "./auth";

/**
 * Google as function tools for the question agent (/api/agent): read the calendar,
 * Gmail and Tasks, and send an email only after the user says yes.
 */

const TZ = "Europe/Prague";
const str = (description: string) => ({ type: "string", description });

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
    description: "Nesplněné úkoly uživatele v Google Tasks.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
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

type Draft = { to: string; subject: string; body: string; at: number };
const drafts = new Map<string, Draft>();

/** "ano, pošli to" and friends: the only way a prepared email gets sent. */
const CONFIRM = /(?<![\p{L}])(ano|jo|jasně|jasne|pošli|posli|odešli|odesli|potvrzuj[iu]|můžeš|muzes|klidně|klidne|souhlasím|souhlasim)(?![\p{L}])/iu;
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
      const r = await google<{ items?: { title?: string; due?: string; notes?: string; parent?: string }[] }>(
        "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=50",
      );
      return (r.items ?? []).map((t) => ({ úkol: t.title, termín: t.due?.slice(0, 10), podúkol: !!t.parent }));
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
    default:
      return { chyba: `Neznámý nástroj ${name}` };
  }
}
