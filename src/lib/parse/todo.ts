import { capitalize, collapse } from "./common";

/** `title`: what the list is for ("Příprava na meeting: …"), when given before a colon. */
export type TodoData = { items: string[]; verb: string | null; title?: string };

export function parseTodo(text: string): TodoData {
  let rest = collapse(text.replace(/\n/g, ", "));
  rest = rest.replace(/^(?:to ?do|todo list|list|shopping list|groceries)\s*:?\s*/i, "");
  let title: string | undefined;
  const colon = rest.match(/^([^:,]{3,60}):\s*(.+)$/);
  if (colon) {
    title = capitalize(colon[1].trim());
    rest = colon[2];
  }
  let verb: string | null = null;
  const vm = rest.match(/^(buy|get|pick up|grab|order)\s+/i);
  if (vm) {
    verb = vm[1].toLowerCase();
    rest = rest.slice(vm[0].length);
  }
  const items = rest
    .split(/\s*(?:,|;|\s&\s|\band\b|\n)\s*/i)
    .map((s) => s.trim().replace(/^(?:buy|get|also)\s+/i, "").replace(/[.!]+$/, ""))
    .filter(Boolean)
    .map(capitalize);
  return title ? { items, verb, title } : { items, verb };
}

export function completeTodo(d: TodoData) {
  return Math.min(1, d.items.length / 3);
}
