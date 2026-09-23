import { z } from "zod";

/** Meeting minutes, rewritten as the meeting goes on; `overview` is the final summary paragraph. */
export const minutesSchema = z.object({
  title: z.string(),
  overview: z.string().default(""),
  summary: z.array(z.string()),
  decisions: z.array(z.string()),
  actions: z.array(z.object({ task: z.string(), owner: z.string().nullable(), due: z.string().nullable() })),
  questions: z.array(z.string()),
});
export type Minutes = z.infer<typeof minutesSchema>;

export const EMPTY_MINUTES: Minutes = { title: "", overview: "", summary: [], decisions: [], actions: [], questions: [] };

/** One stretch of speech. `speaker` is the diarization label ("A", "B"…), null from the live transcript. */
export type Segment = { at: number; text: string; speaker: string | null };

/** A finished meeting as archived (data/meetings/<id>.json, plus <id>.md for Obsidian). */
export type MeetingRecord = {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  participants: string[];
  /** Diarization label → name ("A" → "Petr"). */
  speakers: Record<string, string>;
  segments: Segment[];
  minutes: Minutes;
  keepNote?: string;
};

export const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};

export const speakerName = (r: Pick<MeetingRecord, "speakers">, label: string | null) => (label ? (r.speakers[label] ?? `Mluvčí ${label}`) : null);

/** The transcript as lines, with names where known ("[0:12] Petr: …"). */
export const transcriptText = (r: Pick<MeetingRecord, "speakers" | "segments">) =>
  r.segments.map((s) => `[${clock(s.at)}] ${speakerName(r, s.speaker) ? `${speakerName(r, s.speaker)}: ` : ""}${s.text}`).join("\n");

/** "do příštího pátku" stays as is, "1. 11." becomes "do 1. 11.". */
export const dueText = (due: string | null) => (!due ? null : /^(do|od|v|ve|na|během|nejpozději)\s/i.test(due) ? due : `do ${due}`);

/** One action item as a line: "Nastavit Comgate (Petr) do příštího pátku". */
export const actionText = (a: { task: string; owner: string | null; due: string | null }) => [a.task, a.owner && `(${a.owner})`, dueText(a.due)].filter(Boolean).join(" ");

/** Plain text for Keep, the saved card and the archive. */
export function minutesText(m: Minutes, when: string) {
  const list = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((i) => `• ${i}`).join("\n")}\n` : "");
  return [
    `${m.title || "Meeting"} (${when})\n`,
    list("Shrnutí", m.summary),
    list("Rozhodnutí", m.decisions),
    list("Úkoly", m.actions.map(actionText)),
    list("Otevřené otázky", m.questions),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}
