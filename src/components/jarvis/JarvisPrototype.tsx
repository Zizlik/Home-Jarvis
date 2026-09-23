"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useSyncExternalStore } from "react";
import { type LogLine, useJarvis } from "@/hooks/useJarvis";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};

const KIND: Record<LogLine["kind"], string> = {
  you: "Ty",
  jarvis: "Jarvis",
  tool: "Nástroj",
  info: "",
  error: "Chyba",
};

/** Step 1: talk to GPT-Live in Czech and watch the card tools run. The full card UI comes next. */
export function JarvisPrototype() {
  const { status, log, card, saved, start, stop } = useJarvis();
  const voice = useSyncExternalStore(
    subscribeNoop,
    () => new URLSearchParams(window.location.search).get("voice") ?? "marin",
    () => "marin",
  );
  const busy = status === "connecting" || status === "closing";

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pt-[10vh] pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jarvis</h1>
          <p className="text-sm text-muted-foreground">Prototyp · gpt-live-1 · hlas {voice}</p>
        </div>
        <button
          type="button"
          onClick={() => (status === "idle" ? start(voice) : stop())}
          disabled={busy}
          aria-label={status === "live" ? "Ukončit rozhovor" : "Začít mluvit"}
          className={cn(
            "relative grid size-16 place-items-center rounded-full transition-colors",
            status === "live" ? "bg-brand text-white" : "bg-muted text-foreground hover:bg-muted/70",
            busy && "opacity-60",
          )}
        >
          {status === "live" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/30" />}
          {busy ? <Loader2 className="size-6 animate-spin" /> : status === "live" ? <Square className="relative size-5 fill-current" /> : <Mic className="size-7" />}
        </button>
      </header>

      <section aria-label="Karta" className="rounded-2xl border bg-card p-5 shadow-sm">
        {card ? (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{card.label}</p>
            <p className="mt-1 text-lg font-medium" data-testid="card-summary">{card.summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              „{card.text}“ · jistota {Math.round(card.confidence * 100)} %
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Řekni třeba „Zapiš večeři s Petrem v pátek v osm“.</p>
        )}
      </section>

      {saved.length > 0 && (
        <section aria-label="Uložené" className="flex flex-col gap-2">
          {saved.map((c, i) => (
            <div key={i} className="flex justify-between rounded-xl border px-4 py-2 text-sm">
              <span>{c.summary}</span>
              <span className="text-muted-foreground">{c.label}</span>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Průběh" className="flex flex-col gap-1.5 font-mono text-[13px]" data-testid="log">
        {log.map((l, i) => (
          <p key={i} className={cn(l.kind === "error" && "text-red-600", l.kind === "tool" && "text-muted-foreground", l.kind === "info" && "text-muted-foreground italic")}>
            <span className="me-2 inline-block w-14 text-end text-muted-foreground tabular-nums">{(l.at / 1000).toFixed(1)}s</span>
            {KIND[l.kind] && <b className="me-1">{KIND[l.kind]}:</b>}
            {l.text}
          </p>
        ))}
      </section>
    </main>
  );
}
