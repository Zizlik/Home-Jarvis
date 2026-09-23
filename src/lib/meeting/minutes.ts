import { z } from "zod";

/** Meeting minutes, rewritten as the meeting goes on. */
export const minutesSchema = z.object({
  title: z.string(),
  summary: z.array(z.string()),
  decisions: z.array(z.string()),
  actions: z.array(z.object({ task: z.string(), owner: z.string().nullable(), due: z.string().nullable() })),
  questions: z.array(z.string()),
});
export type Minutes = z.infer<typeof minutesSchema>;

export const EMPTY_MINUTES: Minutes = { title: "", summary: [], decisions: [], actions: [], questions: [] };

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
