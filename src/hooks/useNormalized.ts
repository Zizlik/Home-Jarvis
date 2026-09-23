"use client";

import { useEffect, useState } from "react";
import { LRU, normalizeKey } from "@/lib/lru";

const cache = new LRU<string, string | null>(300);

/**
 * Gemini's English rewrite of Czech input: the fallback for sentences the
 * built-in Czech rules (lib/cs) leave incomplete. Only fetched when `enabled`;
 * until a new rewrite lands, the previous one stands in while the same sentence is typed.
 */
export function useNormalized(text: string, enabled: boolean, { debounceMs = 400 }: { debounceMs?: number } = {}): string | null {
  const [latest, setLatest] = useState<{ text: string; normalized: string | null }>({ text: "", normalized: null });
  const key = normalizeKey(text);
  const cached = cache.get(key);

  useEffect(() => {
    if (!enabled || key.length < 2 || cache.get(key) !== undefined) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/normalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const { normalizedText } = (await res.json()) as { normalizedText: string | null };
        cache.set(key, normalizedText);
        setLatest({ text, normalized: normalizedText });
      } catch {
        // aborted or offline: the built-in rules already cover it
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, key, enabled, debounceMs]);

  if (!text.trim()) return null;
  if (cached !== undefined) return cached;
  const sameSentence = text.startsWith(latest.text) || latest.text.startsWith(text);
  return sameSentence ? latest.normalized : null;
}
