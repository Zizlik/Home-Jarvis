import { capitalize, collapse, findDate, removeDate, tidy } from "./common";

export type ReminderData = { task: string; when: Date | null; hasTime: boolean };

export function parseReminder(text: string, ref?: Date): ReminderData {
  let rest = ` ${collapse(text)} `;
  rest = rest.replace(/\s(?:please\s+)?(?:remind me(?:\s+to)?|reminder:?|don'?t forget(?:\s+to)?|remember to)\s/i, " ");
  rest = rest.replace(/\s(?:urgent(?:ly)?|asap|important|!+)(?=\s|$)/gi, " ");
  const date = findDate(rest, ref);
  if (date) rest = removeDate(rest, date);
  return { task: capitalize(tidy(rest)), when: date?.start ?? null, hasTime: date?.hasTime ?? false };
}

export function completeReminder(d: ReminderData) {
  return (d.task ? 0.55 : 0) + (d.when ? 0.3 : 0) + (d.hasTime ? 0.15 : 0);
}
