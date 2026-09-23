/**
 * Running timers, shared by the whole app (voice, cards, meetings) and kept in
 * localStorage, so a timer outlives the card or conversation that started it.
 */
export type RunningTimer = { id: number; label: string; seconds: number; endsAt: number; pausedLeft?: number };

const KEY = "jarvis:timers:v1";
const EMPTY: RunningTimer[] = [];
let items: RunningTimer[] | null = null;
const listeners = new Set<() => void>();

function load(): RunningTimer[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RunningTimer[];
    // Drop timers that ended long ago (e.g. while the page was closed).
    return Array.isArray(list) ? list.filter((t) => t.pausedLeft !== undefined || t.endsAt > Date.now() - 60_000) : [];
  } catch {
    return [];
  }
}

function save(next: RunningTimer[]) {
  items = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: timers still run for this visit
  }
  listeners.forEach((l) => l());
}

export const timers = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: (): RunningTimer[] => (items ??= load()),
  getServerSnapshot: (): RunningTimer[] => EMPTY,
  /** Start a countdown now. */
  add(label: string, seconds: number) {
    const t = { id: Date.now() + Math.random(), label: label || "Časovač", seconds, endsAt: Date.now() + seconds * 1000 };
    save([...timers.getSnapshot(), t]);
    return t;
  },
  remove: (id: number) => save(timers.getSnapshot().filter((t) => t.id !== id)),
  toggle(id: number) {
    save(
      timers.getSnapshot().map((t) =>
        t.id !== id ? t : t.pausedLeft !== undefined ? { ...t, endsAt: Date.now() + t.pausedLeft, pausedLeft: undefined } : { ...t, pausedLeft: Math.max(0, t.endsAt - Date.now()) },
      ),
    );
  },
};

/** "přestávku" → "Přestávka": the label as a name, not the object of "na". */
export function timerLabel(label: string) {
  const l = label.trim().replace(/^(na|pro)\s+/i, "");
  const nom = l.replace(/^(\p{L}+?)([^aeiouyáéíóúůý])u(?=\s|$)/u, "$1$2a");
  return nom ? nom.charAt(0).toUpperCase() + nom.slice(1) : "Časovač";
}
