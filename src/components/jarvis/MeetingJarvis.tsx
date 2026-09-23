"use client";

import { Calculator, CheckSquare, Ear, Loader2, MessageSquare, Sparkles, Timer, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ShapeshiftController } from "@/components/shapeshift/Shapeshift";
import { type Activity, type MeetingHooks, useJarvis } from "@/hooks/useJarvis";
import type { useMeeting } from "@/hooks/useMeeting";
import { chime, useWakeWord } from "@/hooks/useWakeWord";
import { actionText, clock } from "@/lib/meeting/minutes";
import { cn } from "@/lib/utils";
import { Timers } from "./Timers";

type Mode = "participant" | "call" | "off";
const MODE_KEY = "jarvis.meetingMode";

const MODES: { value: Mode; label: string; hint: string; icon: typeof Ear }[] = [
  { value: "participant", label: "Účastník", hint: "je v meetingu celou dobu, ozve se na oslovení (~3 $ za hodinu)", icon: UserRound },
  { value: "call", label: "Na zavolání", hint: "připojí se na „Hey Jarvis“, po 30 s ticha odejde", icon: Ear },
  { value: "off", label: "Vypnuto", hint: "jen přepis a zápis", icon: Sparkles },
];

const PARTICIPANT = `Jsi Jarvis, účastník pracovního meetingu více lidí. Celou dobu posloucháš.
MLČ, dokud tě někdo výslovně neosloví jménem („Jarvisi…“, „Jarvis, …“) nebo se tě přímo nezeptá. Lidé mluví hlavně mezi sebou: jejich hovor nekomentuj, nepotvrzuj, neshrnuj a neodpovídej na otázky, které si kladou navzájem.
Když tě osloví, odpověz krátce a věcně (jedna až dvě věty) a zase mlč. Úkoly a data předávej aplikaci jako obvykle.`;

const ON_CALL = `Jsi Jarvis a právě tě někdo na meetingu zavolal („Hey Jarvis“). Odpověz na to, co chce, krátce a věcně, a pak mlč. Lidé kolem mluví i mezi sebou: reaguj jen na to, co je určené tobě.`;

type Item = Activity & { id: number; at: number };

const ICON = { task: CheckSquare, result: Calculator, timer: Timer, answer: MessageSquare } as const;

const subscribeNoop = () => () => {};

function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "call" || v === "off" ? v : "participant";
  } catch {
    return "participant";
  }
}

/** Jarvis on a running meeting: as a participant the whole time, on "Hey Jarvis", or not at all. */
export function MeetingJarvis({ meeting }: { meeting: ReturnType<typeof useMeeting> }) {
  // The saved choice, read on the client only (the server render can't see localStorage).
  const stored = useSyncExternalStore(subscribeNoop, readMode, () => "participant" as Mode);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode = picked ?? stored;
  // What Jarvis did on this meeting (newest first): tasks, results, timers, answers.
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);
  const noCards = useRef<ShapeshiftController>(null);

  // Latest minutes and transcript for Jarvis's answers, without re-creating the hooks.
  const latest = useRef(meeting);
  useEffect(() => {
    latest.current = meeting;
  });
  const hooks = useMemo<MeetingHooks>(
    () => ({
      context: () => {
        const m = latest.current;
        const minutes = [
          m.title && `Název: ${m.title}`,
          m.participants.length && `Účastníci: ${m.participants.join(", ")}`,
          m.minutes.summary.length && `Zatím probráno: ${m.minutes.summary.join("; ")}`,
          m.minutes.decisions.length && `Rozhodnutí: ${m.minutes.decisions.join("; ")}`,
          m.minutes.actions.length && `Úkoly: ${m.minutes.actions.map(actionText).join("; ")}`,
        ]
          .filter(Boolean)
          .join("\n");
        const transcript = m.segments.map((s) => s.text).join("\n").slice(-10_000);
        return `${minutes}\nPřepis (konec):\n${transcript}`;
      },
      addAction: (task) => latest.current.addAction(task),
      end: () => void latest.current.stop(),
      rename: (t) => latest.current.setTitle(t),
      activity: (a) => setItems((list) => [{ ...a, id: ++nextId.current, at: Date.now() }, ...list].slice(0, 30)),
    }),
    [],
  );
  const jarvis = useJarvis(noCards, hooks);
  // Jarvis's words go into the meeting transcript (and the .md) as "Jarvis".
  const { setJarvisSaid } = meeting;
  const jarvisLog = jarvis.log;
  useEffect(() => {
    setJarvisSaid(jarvisLog.filter((l) => l.kind === "jarvis").map((l) => ({ ts: l.ts, text: l.text.replace(/\s*\[[^\]]*\]?\s*/g, " ").trim() })));
  }, [jarvisLog, setJarvisSaid]);
  // A new meeting starts with an empty list (adjusted during render, not in an effect).
  const [seenStatus, setSeenStatus] = useState(meeting.status);
  if (seenStatus !== meeting.status) {
    setSeenStatus(meeting.status);
    if (meeting.status === "connecting") setItems([]);
  }
  const { announce } = jarvis;
  const timerDone = useCallback(
    (label: string) => {
      announce(`Časovač „${label}“ právě doběhl. Krátce to oznam.`);
    },
    [announce],
  );
  const live = meeting.status === "live";

  /** Short context for Jarvis when it connects (a Live append holds ~500 tokens). */
  const intro = () => {
    const m = latest.current;
    return [`Meeting: ${m.title || "bez názvu"}.`, m.participants.length ? `Účastníci: ${m.participants.join(", ")}.` : "", m.minutes.summary.slice(-6).join(" ")].join(" ").slice(0, 1500);
  };

  // Participant: join when the meeting starts, rejoin if the session drops, leave with the meeting.
  const joins = useRef(0);
  const { status: jarvisStatus, start, stop } = jarvis;
  // Jarvis gets its own copy of the mic track: sharing one track with the transcription stalls one of them.
  const ownMic = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!live || mode !== "participant" || jarvisStatus !== "idle" || !meeting.stream || joins.current >= 5) return;
    const t = setTimeout(() => {
      joins.current++;
      ownMic.current?.getTracks().forEach((tr) => tr.stop());
      ownMic.current = meeting.stream!.clone();
      void start(undefined, ownMic.current, { instructions: PARTICIPANT, context: intro(), stayOn: true });
    }, joins.current ? 2000 : 0);
    return () => clearTimeout(t);
  }, [live, mode, jarvisStatus, meeting.stream, start]);
  useEffect(() => {
    if (jarvisStatus !== "idle") return;
    ownMic.current?.getTracks().forEach((tr) => tr.stop());
    ownMic.current = null;
  }, [jarvisStatus]);
  useEffect(() => () => ownMic.current?.getTracks().forEach((tr) => tr.stop()), []);
  useEffect(() => {
    if (!live && jarvisStatus !== "idle") stop();
    if (!live) joins.current = 0;
  }, [live, jarvisStatus, stop]);
  useEffect(() => {
    if (mode === "off" && jarvisStatus !== "idle") stop();
  }, [mode, jarvisStatus, stop]);

  // On call: "Hey Jarvis" while the meeting runs.
  const wake = useWakeWord(live && mode === "call", jarvisStatus !== "idle", (mic) => {
    chime("heard");
    void start(undefined, mic, { instructions: ON_CALL, context: intro() });
  });

  const pick = (m: Mode) => {
    setPicked(m);
    if (m !== "participant" && jarvisStatus !== "idle") stop();
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // private mode: the choice holds for this visit
    }
  };

  const state =
    mode === "off"
      ? "Jarvis se meetingu neúčastní."
      : jarvisStatus === "live"
        ? mode === "participant"
          ? "Jarvis je v meetingu. Oslov ho „Jarvisi, …“."
          : "Jarvis poslouchá, mluv."
        : jarvisStatus === "connecting"
          ? "Jarvis se připojuje…"
          : mode === "call"
            ? wake.status === "needs-click"
              ? "Klikni kamkoliv, aby šlo zavolat „Hey Jarvis“."
              : wake.status === "loading"
                ? "Načítám poslech…"
                : "Zavolej „Hey Jarvis“."
            : live
              ? "Jarvis se připojí se začátkem meetingu."
              : "Jarvis se připojí, až meeting začne.";

  const spoken = jarvis.log.filter((l) => l.kind === "jarvis").slice(-1)[0]?.text.replace(/\s*\[[^\]]*\]?\s*/g, " ").trim();

  return (
    <section aria-label="Jarvis na meetingu" className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm">
          {jarvisStatus === "connecting" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span className={cn("size-2 rounded-full", jarvisStatus === "live" ? "animate-pulse bg-brand" : "bg-muted-foreground/40")} />
          )}
          <span className="font-medium">Jarvis</span>
          <span className="text-muted-foreground">{state}</span>
        </p>
        <div role="radiogroup" aria-label="Jarvis na meetingu" className="flex rounded-full border p-0.5 text-xs">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              title={m.hint}
              onClick={() => pick(m.value)}
              className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors", mode === m.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              <m.icon className="size-3.5" /> {m.label}
            </button>
          ))}
        </div>
      </div>
      {/* What Jarvis is saying right now; what it did stays in the list below. */}
      {spoken && jarvisStatus !== "idle" && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm leading-relaxed">
          <span className="me-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Jarvis</span>
          {spoken}
        </p>
      )}
      <Timers onDone={timerDone} />
      {items.length > 0 && (
        <ul aria-label="Co Jarvis udělal" className="flex flex-col gap-1.5">
          {items.map((it) => {
            const Icon = ICON[it.kind];
            const time = new Date(it.at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
            return (
              <li key={it.id} className="group flex items-start gap-3 rounded-xl border px-3 py-2 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {it.kind === "task"
                      ? "Úkol do zápisu"
                      : it.kind === "result"
                        ? it.label
                        : it.kind === "timer"
                          ? "Časovač"
                          : `Odpověď na „${it.question.replace(/^(hey\s+)?jarvis\p{L}*[,\s]*/iu, "")}“`}{" "}
                    · {time}
                  </p>
                  <p className="break-words">{it.kind === "timer" ? `${it.label}, ${clock(it.seconds)} (odpočet je nahoře)` : it.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                  aria-label="Odebrat"
                  className="text-muted-foreground opacity-60 hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Full log (what was said, tool steps) for debugging. */}
      <div hidden data-testid="jarvis-log">
        {jarvis.log.map((l) => `${(l.at / 1000).toFixed(1)}s ${l.kind}: ${l.text}`).join("\n")}
      </div>
    </section>
  );
}
