"use client";

import { Pause, Play, Timer, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chime } from "@/hooks/useWakeWord";
import { clock } from "@/lib/meeting/minutes";
import { notify } from "@/lib/notify";
import { type RunningTimer, timers } from "@/lib/timers";
import { cn } from "@/lib/utils";

/** Running timers with a live countdown; rings at the end and calls `onDone` (e.g. Jarvis says so). */
export function Timers({ onDone, className }: { onDone?: (label: string) => void; className?: string }) {
  const list = useSyncExternalStore(timers.subscribe, timers.getSnapshot, timers.getServerSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const rung = useRef(new Set<number>());
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!list.length) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [list.length]);

  // Ring once per timer when it reaches zero.
  useEffect(() => {
    for (const t of list) {
      if (t.pausedLeft !== undefined || t.endsAt > now || rung.current.has(t.id)) continue;
      rung.current.add(t.id);
      chime("ready");
      setTimeout(() => chime("ready"), 450);
      setTimeout(() => chime("ready"), 900);
      notify(`Časovač „${t.label}“ doběhl.`, { id: `timer-${t.id}` });
      done.current?.(t.label);
    }
  }, [list, now]);

  if (!list.length) return null;
  // Clamped: right after a timer is added, `now` can still be a moment old.
  const left = (t: RunningTimer) => Math.min(t.seconds, Math.max(0, Math.ceil((t.pausedLeft ?? t.endsAt - now) / 1000)));

  return (
    <ul aria-label="Časovače" className={cn("flex flex-col gap-1.5", className)}>
      {list.map((t) => {
        const s = left(t);
        const pct = Math.min(100, ((t.seconds - s) / t.seconds) * 100);
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm shadow-sm">
            <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{t.label}</span>
                <span className={cn("font-mono text-lg tabular-nums", s === 0 && "animate-pulse text-brand")}>{s === 0 ? "Hotovo" : clock(s)}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {s > 0 && (
              <button type="button" onClick={() => timers.toggle(t.id)} aria-label={t.pausedLeft !== undefined ? "Pokračovat" : "Pozastavit"} className="text-muted-foreground hover:text-foreground">
                {t.pausedLeft !== undefined ? <Play className="size-4" /> : <Pause className="size-4" />}
              </button>
            )}
            <button type="button" onClick={() => timers.remove(t.id)} aria-label="Zrušit časovač" className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
