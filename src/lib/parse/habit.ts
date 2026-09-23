import { capitalize, collapse, tidy } from "./common";

export type HabitData = { title: string; days: number[]; perWeek: number | null; label: string | null };

const PART_OF_DAY: Record<string, string> = { morning: "Každé ráno", night: "Každou noc", evening: "Každý večer", afternoon: "Každé odpoledne" };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_RE = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?s?\b/gi;

export function parseHabit(text: string): HabitData {
  let rest = ` ${collapse(text)} `;
  let days: number[] = [];
  let perWeek: number | null = null;
  let label: string | null = null;

  const nx = rest.match(/\b(\d|once|twice|thrice)\s*(?:x|times?)?\s*(?:a|per|each|every)\s+week\b/i);
  if (nx) {
    const word = nx[1].toLowerCase();
    perWeek = word === "once" ? 1 : word === "twice" ? 2 : word === "thrice" ? 3 : Number(word);
    rest = rest.replace(nx[0], " ");
    label = `${perWeek}× týdně`;
  }

  if (/\b(?:every\s*day|daily|every (?:morning|night|evening|afternoon)|each (?:day|morning|night))\b/i.test(rest)) {
    days = [0, 1, 2, 3, 4, 5, 6];
    const part = rest.match(/\b(?:every|each)\s+(morning|night|evening|afternoon)\b/i);
    label = part ? PART_OF_DAY[part[1].toLowerCase()] : "Denně";
    rest = rest.replace(/\b(?:every\s*day|daily|every (?:morning|night|evening|afternoon)|each (?:day|morning|night))\b/gi, " ");
  } else if (/\b(?:weekdays|every weekday)\b/i.test(rest)) {
    days = [1, 2, 3, 4, 5];
    label = "Pracovní dny";
    rest = rest.replace(/\b(?:every\s+)?weekdays?\b/gi, " ");
  } else if (/\b(?:weekends|every weekend)\b/i.test(rest)) {
    days = [0, 6];
    label = "Víkendy";
    rest = rest.replace(/\b(?:every\s+)?weekends?\b/gi, " ");
  } else {
    const found = new Set<number>();
    rest = rest.replace(DAY_RE, (m: string, d: string) => {
      const i = DAYS.indexOf(d.slice(0, 3).toLowerCase());
      if (i >= 0) found.add(i);
      return " ";
    });
    if (found.size) {
      days = [...found].sort();
      if (!label) label = days.length === 1 ? `Každ${days[0] === 0 || days[0] === 3 || days[0] === 6 ? "ou" : "é"} ${fullDay(days[0])}` : `${days.length}× týdně`;
    }
  }

  if (!label && /\bweekly\b/i.test(rest)) {
    perWeek = 1;
    label = "Každý týden";
  }

  rest = rest.replace(/\b(?:every|each|weekly|habit|routine|start|i want to|i will|i'll|and)\b/gi, " ");
  rest = rest.replace(/\b(?:in the )?(?:morning|night|evening)s?\b/gi, " ");
  rest = rest.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at\s+)?\d{1,2}:\d{2}\b/gi, " ");
  if (!days.length && perWeek) days = spread(perWeek);
  return { title: capitalize(tidy(rest)), days, perWeek, label };
}

function fullDay(i: number) {
  return ["neděli", "pondělí", "úterý", "středu", "čtvrtek", "pátek", "sobotu"][i];
}

/** Evenly spread N sessions across Mon–Sun so the week strip has a sensible default. */
function spread(n: number): number[] {
  const order = [1, 3, 5, 0, 2, 4, 6];
  const presets: Record<number, number[]> = { 1: [1], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };
  return (presets[n] ?? order.slice(0, Math.min(7, n))).sort();
}

export function completeHabit(d: HabitData) {
  return (d.title ? 0.5 : 0) + (d.label ? 0.5 : 0);
}
