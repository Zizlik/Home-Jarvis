"use client";

import { useEffect, useRef } from "react";
import { type GoogleSyncPrefs, toGoogle } from "@/lib/google/cards";
import { notify } from "@/lib/notify";
import { type SavedItem, savedItems } from "@/lib/savedItems";

type Ref = NonNullable<SavedItem["google"]>;

async function call(body: object): Promise<{ ref?: Ref; error?: string }> {
  const res = await fetch("/api/google/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ error: "Google neodpovídá." }))) as { ref?: Ref; error?: string };
}

const setGoogle = (id: number, patch: Partial<Pick<SavedItem, "google" | "googleError">>) =>
  savedItems.update((list) => list.map((x) => (x.id === id ? { ...x, google: undefined, googleError: undefined, ...patch } : x)));

const TARGET: Record<Ref["target"], string> = { calendar: "Google Kalendáře", tasks: "Google Tasks", keep: "Google Keep" };

/**
 * Mirrors the saved list into Google while the page is open: a newly saved card
 * is written (calendar, Tasks, Keep, per settings), an edited one is replaced,
 * a deleted one is removed. Cards saved before the page loaded are left alone.
 */
export function useGoogleSync() {
  const prefs = useRef<GoogleSyncPrefs | null>(null);
  const prev = useRef<Map<number, SavedItem> | null>(null);
  const busy = useRef(new Set<number>());

  useEffect(() => {
    let alive = true;
    (async () => {
      const [status, settings] = await Promise.all([
        fetch("/api/google/status").then((r) => r.json()).catch(() => null),
        fetch("/api/settings").then((r) => r.json()).catch(() => null),
      ]);
      if (alive && status?.connected && settings?.google) prefs.current = settings.google as GoogleSyncPrefs;
    })();

    const onChange = async () => {
      const now = new Map(savedItems.getSnapshot().map((x) => [x.id, x]));
      const before = prev.current;
      prev.current = now;
      const p = prefs.current;
      if (!before || !p) return;

      // Deleted: remove from Google too.
      for (const [id, old] of before) {
        if (!now.has(id) && old.google) {
          const r = await call({ op: "remove", ref: old.google });
          if (r.error) notify(`Z Googlu se nepodařilo smazat: ${r.error}`, { id: "google" });
        }
      }
      for (const [id, item] of now) {
        if (busy.current.has(id)) continue;
        const old = before.get(id);
        const isNew = !old;
        const edited = old && (old.text !== item.text || old.intent !== item.intent);
        if (!isNew && !edited) continue;
        const card = toGoogle(item, p);
        if (!card) continue;
        busy.current.add(id);
        try {
          if (edited && old?.google) await call({ op: "remove", ref: old.google });
          if ("skip" in card) {
            setGoogle(id, { googleError: card.skip });
            continue;
          }
          const r = await call({ op: "create", card });
          if (r.ref) {
            setGoogle(id, { google: r.ref });
            notify(`Zapsáno do ${TARGET[r.ref.target]}`, { id: "google" });
          } else {
            setGoogle(id, { googleError: r.error ?? "Nepodařilo se zapsat do Googlu." });
            notify(`Do Googlu se nepodařilo zapsat: ${r.error ?? "neznámá chyba"}`, { id: "google" });
          }
        } finally {
          busy.current.delete(id);
          // Our own setGoogle() changed the list: take it as the new baseline.
          prev.current = new Map(savedItems.getSnapshot().map((x) => [x.id, x]));
        }
      }
    };

    prev.current = new Map(savedItems.getSnapshot().map((x) => [x.id, x]));
    const unsubscribe = savedItems.subscribe(() => void onChange());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
}
