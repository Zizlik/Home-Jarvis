"use client";

import { Captions, CaptionsOff, Loader2, Settings, Sparkles, Square } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Shapeshift, type ShapeshiftController } from "@/components/shapeshift/Shapeshift";
import { type LogLine, useJarvis } from "@/hooks/useJarvis";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};
const TRANSCRIPT_KEY = "jarvis.transcript";

const KIND: Record<LogLine["kind"], string> = { you: "Ty", jarvis: "Jarvis", tool: "", info: "", error: "Chyba" };

function readPref() {
  try {
    return localStorage.getItem(TRANSCRIPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shapeshift's input, cards and saved list, with Jarvis's voice driving them. */
export function Jarvis() {
  const shapeshift = useRef<ShapeshiftController>(null);
  const { status, log, answer, start, stop } = useJarvis(shapeshift);
  // ?voice= overrides the saved voice, for trying voices out.
  const voice = useSyncExternalStore(
    subscribeNoop,
    () => new URLSearchParams(window.location.search).get("voice") ?? "",
    () => "",
  );
  const stored = useSyncExternalStore(subscribeNoop, readPref, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const transcript = override ?? stored;
  const toggleTranscript = () => {
    const next = !transcript;
    setOverride(next);
    try {
      localStorage.setItem(TRANSCRIPT_KEY, next ? "1" : "0");
    } catch {
      // private mode: the toggle still works for this visit
    }
  };

  const busy = status === "connecting" || status === "closing";
  const live = status === "live";
  // Only what was said; tool steps stay in the hidden debug log below.
  // Sound cues ("[exhale]", "[clear throat]") can arrive split across deltas.
  const lines = log
    .filter((l) => l.kind === "you" || l.kind === "jarvis" || l.kind === "error")
    .map((l) => ({ ...l, text: l.text.replace(/\[[^\]]*(?:\]|$)/g, " ").replace(/^\s*\]/, "").replace(/\s{2,}/g, " ").trim() }))
    .filter((l) => l.text);

  const talk = (
    <button
      type="button"
      onClick={() => (status === "idle" ? start(voice || undefined) : stop())}
      disabled={busy}
      aria-label={live ? "Ukončit rozhovor s Jarvisem" : "Mluvit s Jarvisem"}
      aria-pressed={live}
      className={cn(
        "relative z-[1] ms-2 grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200",
        live ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60",
      )}
    >
      {live && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand/40" />}
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : live ? (
        <Square className="relative size-3.5 fill-current" aria-hidden />
      ) : (
        <Sparkles className="size-[18px]" aria-hidden />
      )}
    </button>
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          Jarvis
          {live && <span className="text-xs font-normal text-muted-foreground">poslouchám</span>}
          {status === "connecting" && <span className="text-xs font-normal text-muted-foreground">připojuji…</span>}
        </p>
        <nav className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTranscript}
            aria-pressed={transcript}
            aria-label={transcript ? "Skrýt přepis" : "Zobrazit přepis"}
            title={transcript ? "Skrýt přepis" : "Zobrazit přepis"}
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {transcript ? <Captions className="size-[18px]" /> : <CaptionsOff className="size-[18px]" />}
          </button>
          <a
            href="/nastaveni"
            aria-label="Nastavení"
            title="Nastavení"
            className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-[18px]" />
          </a>
        </nav>
      </header>

      <Shapeshift controllerRef={shapeshift} inputAction={talk}>
        {answer && (
          <section aria-label="Odpověď Jarvise" className="mt-4 rounded-2xl border bg-card p-5 text-[15px] leading-relaxed shadow-sm">
            {answer}
          </section>
        )}
        {transcript && lines.length > 0 && (
          <section aria-label="Přepis" data-testid="log" className="mt-4 flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-2xl border px-4 py-3 text-sm">
            {lines.map((l, i) => (
              <p key={i} className={cn(l.kind === "error" && "text-red-600", l.kind === "you" && "text-muted-foreground")}>
                {KIND[l.kind] && <b className="me-1 font-medium text-foreground">{KIND[l.kind]}:</b>}
                {l.text}
              </p>
            ))}
          </section>
        )}
        {/* The full log (tool steps, timings) stays available in the DOM for debugging. */}
        <div hidden data-testid="debug-log">
          {log.map((l) => `${(l.at / 1000).toFixed(1)}s ${l.kind}: ${l.text}`).join("\n")}
        </div>
      </Shapeshift>
    </>
  );
}
