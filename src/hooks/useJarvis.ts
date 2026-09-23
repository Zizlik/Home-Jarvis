"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ShapeshiftController } from "@/components/shapeshift/Shapeshift";
import { buildCard, type Card, cardText, classify, decide, DESTINATION, targetIntent } from "@/lib/jarvis/cards";
import type { CardIntent, IntentResult } from "@/lib/jev/types";
import { registry } from "@/components/intents/registry";
import { chime } from "@/hooks/useWakeWord";
import { type SavedItem, savedItems } from "@/lib/savedItems";
import { findSaved, hasContent, overlap } from "@/lib/jarvis/saved";
import { periodFor } from "@/lib/jarvis/period";
import { parseTextFor } from "@/lib/cs";
import { parseFor } from "@/lib/parse";
import { timerLabel, timers } from "@/lib/timers";
import { getVerbosity, setVerbosity, VERBOSITY_INSTRUCTIONS, VERBOSITY_LABEL, verbosityCommand } from "@/lib/jarvis/verbosity";

export type JarvisStatus = "idle" | "connecting" | "live" | "closing";
/** `at`: ms since this conversation started; `ts`: wall clock (Date.now()) when the line began. */
export type LogLine = { at: number; ts: number; kind: "you" | "jarvis" | "tool" | "info" | "error"; text: string };

/** `ownMic`: the session opened the mic itself (vs. reusing the wake word's) and closes it. */
type Conn = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  mic: MediaStream;
  ownMic: boolean;
  audio: HTMLAudioElement;
  idle: ReturnType<typeof setInterval>;
  unsubscribe: () => void;
};

/** Hang up after this long with nobody speaking: a voice session bills per second. */
const IDLE_MS = 30_000;

/** "…, ulož to" at the end of a dictation: the card first, then the command. */
const TRAILING_COMMAND =
  /^(.*\S)[\s,.;!…]+((?:(?:a|tak|no|díky|dík|diky|super|dobře|dobre)[\s,.!]+)*(?:ulož|uloz|uložit|ulozit|přidat|pridat|přidej|pridej|zruš|zrus|zrušit|zrusit|zahoď|zahod|smaž|smaz)(?:\s+(?:to|ji|ho|tu kartu|kartu))?)[\s.!…]*$/iu;

/** The last sentence of what was said. */
const lastSentence = (u: string) => {
  const parts = u.split(/[.!?…]+/).map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? u.trim();
};

const plainWord = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Words that mean "switch off", in any form ("vypni", "ukončit", "ukončíš", "konec", "stop"…). */
const OFF_WORD = /^(vypn\p{L}*|vypin\p{L}*|ukonc\p{L}*|skonc\p{L}*|konec|koncime|konci\p{L}*|stop\p{L}*|staci|zaves\p{L}*|nashle\p{L}*|sbohem|vse|vsechno|dost)$/u;
/** Words around it that don't change the meaning ("tak se vypni", "prosím tě, ukončíš se", "to je vše"). */
const FILLER = /^(tak|se|si|to|je|uz|ted|hned|prosim|prosimte|te|jarvis\p{L}*|diky|dik|dekuju|dekuji|ok|okej|dobre|super|no|a|jo|ano|muzes|mej|mejte|mas|ho|tu|toho|vsechno|ja|bych|chci|potrebuju)$/u;

/**
 * "tak se vypni", "ukončit ukončit konec", "díky, to je vše": the end of what was said
 * is only switch-off words and filler. "vypni světla v kuchyni" isn't.
 */
const isHangUp = (u: string) => {
  const words = u.split(/[^\p{L}]+/u).filter(Boolean).map(plainWord);
  let off = 0;
  let i = words.length - 1;
  for (; i >= 0; i--) {
    if (OFF_WORD.test(words[i])) off++;
    else if (!FILLER.test(words[i])) break;
  }
  // Nothing but switch-off words at the end, and they end a sentence (or the whole utterance).
  const tail = words.slice(i + 1);
  return off > 0 && tail.length > 0 && (i < 0 || OFF_WORD.test(tail[tail.length - 1]) || tail.length <= 4);
};

/** "ulož to", "přidat", "ano, přidej", "jo, potvrď": save the card on screen. */
const SAVE_WORD = /^(uloz\p{L}*|pridat|pridej\p{L}*|pridame|potvrd\p{L}*|ano|jo|jasne|ok|okej|zapis|zapsat|zapiste|dobre|super|hotovo|presne|perfektni|paradni|souhlas\p{L}*|muze|muzes|klidne)$/u;
/** "zahoď to", "zruš", "smaž to": throw the card on screen away. */
const DISCARD_WORD = /^(zahod\p{L}*|zrus\p{L}*|smaz\p{L}*|vymaz\p{L}*|odstran\p{L}*|nechci|nech)$/u;

/** The last sentence is only these words plus filler ("ano, přidej to", "tak to zahoď"). */
const onlyWords = (u: string, kind: RegExp) => {
  const words = lastSentence(u).split(/[^\p{L}]+/u).filter(Boolean).map(plainWord);
  const hits = words.filter((w) => kind.test(w)).length;
  return hits > 0 && words.every((w) => kind.test(w) || FILLER.test(w)) && words.length <= 6;
};

/** Jev's "where to keep it" as a card kind (tasks keep a list a list). */
const targetKind = (t: string, current?: CardIntent | null): CardIntent | null =>
  t === "calendar" ? "event" : t === "tasks" ? (current === "todo" ? "todo" : "reminder") : t === "notes" ? "note" : null;

const fromJev = (r: IntentResult) => r.source === "jev" && r.aboutShown !== undefined;

/** Where the user wants it: Jev when it's sure, else the words ("do kalendáře"). */
function targetOf(r: IntentResult, u: string, current?: CardIntent | null): CardIntent | null {
  if (fromJev(r) && r.target && r.target.value !== "unspecified" && r.target.confidence >= 0.7) return targetKind(r.target.value, current);
  return targetIntent(u);
}

/** Jev: "tak díky, to by bylo všechno", "můžeš jít"; the words as a fallback. */
const wantsHangUp = (r: IntentResult | null, u: string) => isHangUp(u) || (!!r && fromJev(r) && (r.hangUp ?? 0) >= 0.85);

/** What's left after the command words: "" for "jo, přidej to", "mléko" for "jo a přidej ještě mléko". */
const leftoverWords = (u: string) =>
  cardText(u)
    .replace(/(?<![\p{L}])(to|ho|ji|je|že|ze|tě|te|toho|tam|tu|tuhle|tenhle|ten|kartu|prosím|prosim|taky|také|radši|radsi|mi|si|hoď|hod|hodit|dej|dát|dat|přesuň|presun|přehoď|prehod|šoupni|soupni|vlož|vloz|pošli|posli|ulož|uloz|zapiš|zapis|přidej|pridej|přidat|pridat|uložit|ulozit|klidně|klidne|dobře|dobre|jasně|jasne|super|ok|okej|tak|no|jen|yes|ano|jo)(?![\p{L}])/giu, " ")
    .replace(/[,.!?]/g, " ")
    .trim();

type Verdict = { kind: "save" } | { kind: "discard" } | { kind: "move"; to: CardIntent };

/**
 * What to do with the card on screen, from Jev's probabilities with the screen as context:
 * "jo, přidej to" → save, "ne, tohle nechci" → discard, "šoupni to do kalendáře" → move.
 * Without Jev, the old word lists decide.
 */
function cardVerdict(r: IntentResult, u: string, card: { text: string; intent: CardIntent } | null): Verdict | null {
  if (!card) return null;
  if (!fromJev(r)) {
    const to = targetIntent(u);
    if (to && to !== card.intent) return { kind: "move", to };
    if (onlyWords(u, SAVE_WORD)) return { kind: "save" };
    if (onlyWords(u, DISCARD_WORD)) return { kind: "discard" };
    return null;
  }
  if ((r.aboutShown ?? 0) < 0.6) return null;
  const act = r.action?.value;
  const conf = r.action?.confidence ?? 0;
  const to = targetOf(r, u, card.intent);
  if (to && to !== card.intent && act !== "discard") return { kind: "move", to };
  if (act === "discard" && conf >= 0.6) return { kind: "discard" };
  if ((act === "save" && conf >= 0.6) || ((r.confirm ?? 0) >= 0.8 && act !== "update" && act !== "ask" && !leftoverWords(u))) return { kind: "save" };
  return null;
}

/** Jarvis saying goodbye means the conversation is over: hang up in the app too. */
const GOODBYE = /(?<![\p{L}])(vypínám\s+se|vypinam\s+se|vypínám|nashledanou|na\s+shledanou|končím,?\s+ahoj|měj\s+se|mějte\s+se)(?![\p{L}])/iu;

/** "začni meeting", "chci poradu hned", "otevři nastavení": Jarvis's own screens, not cards. */
const OPEN_TOOL: [RegExp, string, string][] = [
  [
    /(?<![\p{L}])(začn\p{L}*|zacn\p{L}*|spusť|spust|zapni|chci|chtěl bych|chtel bych|pusť|pust|nahrávej|nahravej|udělej|udelej|dáme|dame|jdeme na|otevři|otevri)(?![\p{L}]).{0,30}(?<![\p{L}])(meeting\p{L}*|mítink\p{L}*|mitink\p{L}*|porad\p{L}*|zápis z\p{L}*|nahrávání)/iu,
    "/meeting?start=1",
    "Spouštím meeting, přepínám na stránku meetingu a nahrávám.",
  ],
  [/(?<![\p{L}])(otevři|otevri|ukaž|ukaz|jdi do|přejdi do|prejdi do)(?![\p{L}]).{0,15}(nastavení|nastaveni)/iu, "/nastaveni", "Otevírám nastavení."],
];

/** "spusť časovač na 5 minut", "nastav minutku", "spusť ho": start it, don't just show it. */
const START = /(?<![\p{L}])(spusť|spust|spusťte|nastav|zapni|pusť|pust|odpočítej|odpocitej|odstartuj|start|dej)(?![\p{L}])/iu;

/** Meeting commands, acted on from the words alone (like opening a page). */
const END_MEETING =
  /(?<![\p{L}])(ukonči|ukonci|ukončete|ukončit|ukoncit|skonči|skonci|zastav|zastavit|stopni|ukončíme|ukoncime|končíme|koncime)(?![\p{L}]).{0,25}(meeting\p{L}*|mítink\p{L}*|mitink\p{L}*|porad\p{L}*|nahrávání|nahravani|zápis|schůzk\p{L}*|to)(?![\p{L}])/iu;
const RENAME_MEETING = /(?<![\p{L}])(?:přejmenuj|prejmenuj|pojmenuj|nazvi|změň název|zmen nazev)(?:\s+(?:meeting|mítink|mitink|poradu|schůzku|to|ho|ji))?(?:\s+(?:na|jako))?\s*[:,]?\s*(.{2,80}?)[.!]?$/iu;

/** Cards that are an answer rather than something to keep ("kolik je 15 % z…"). */
const ANSWER_CARDS = new Set(["calc", "convert", "timezone", "countdown", "random", "split", "color"]);

/** Long or rambling dictation gets tidied into card text by Gemini (/api/card). */
const needsCleanup = (t: string) => t.split(/\s+/).length > 12 || /…|\.\s+\S.*\.\s+\S/.test(t);

/** Wait until the offer has all its ICE candidates (Live takes no trickle ICE). */
async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Vypršelo navazování spojení.")), 10_000);
    const onState = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

/** Same words, same key: the transcript preview and the delegation share work. */
const keyOf = (u: string) => u.replace(/\[[^\]]*\]?/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Questions answered straight from the data (/api/quick), no agent model. */
const QUICK_TOPICS = new Set(["calendar", "tasks", "notes", "meetings"]);
/** When Jev isn't sure what a question is about, obvious words decide. */
const TOPIC_WORDS: [string, RegExp][] = [
  ["tasks", /(?<![\p{L}])(úkol\p{L}*|ukol\p{L}*|tasks?|to-?do)(?![\p{L}])/iu],
  ["calendar", /(?<![\p{L}])(kalendář\p{L}*|kalendar\p{L}*|program|rozvrh|mám\s+(zítra|dnes|v\s+\p{L}+)\s+něco)(?![\p{L}])/iu],
  ["notes", /(?<![\p{L}])(keep\p{L}*|poznámk\p{L}*|poznamk\p{L}*)(?![\p{L}])/iu],
  ["meetings", /(?<![\p{L}])(meeting\p{L}*|mítink\p{L}*|porad\p{L}*|schůzk\p{L}*\s+jsme)(?![\p{L}])/iu],
];
const topicOf = (r: IntentResult, utterance: string) => {
  const jev = r.askTopic;
  if (jev && QUICK_TOPICS.has(jev.value) && jev.confidence >= 0.8) return jev.value;
  return TOPIC_WORDS.find(([, re]) => re.test(utterance))?.[0] ?? null;
};
const ASKS_DONE = /(?<![\p{L}])(splněn\p{L}*|splnen\p{L}*|hotov\p{L}*|udělal\p{L}*|udelal\p{L}*|dokončen\p{L}*|dokoncen\p{L}*)(?![\p{L}])/iu;

/** What Jarvis knows about the saved list (a Live append holds at most 500 tokens). */
function savedContext(list: SavedItem[]) {
  if (!list.length) return "Uložené karty: zatím žádné.";
  const lines = list.slice(0, 25).map((x, i) => `${i + 1}. ${registry[x.intent].label}: ${x.summary}`);
  return `Uložené karty (nejnovější první, celkem ${list.length}):\n${lines.join("\n")}`.slice(0, 1400);
}

/**
 * GPT-Live over WebRTC with client delegation: Jarvis talks, the app does the work.
 * While the user speaks, Jev reads the running transcript so the card forms live.
 * When Jarvis delegates, Jev's answer decides what to do (new card, change, save,
 * discard) in ~0.3 s; only questions go to a model (/api/agent, with MCP tools).
 */
/**
 * Meeting mode: Jarvis joins a running meeting on "Hey Jarvis". Questions are
 * answered with the meeting's minutes and transcript as context; anything to
 * write down becomes an action item in the meeting's minutes, not a card.
 */
/** Something Jarvis did on a meeting, shown on the meeting page. */
export type Activity =
  | { kind: "task"; summary: string }
  | { kind: "result"; label: string; summary: string }
  | { kind: "timer"; label: string; seconds: number }
  | { kind: "answer"; question: string; summary: string };

export type MeetingHooks = {
  /** Show what Jarvis just did. */
  activity: (a: Activity) => void;
  /** Minutes and recent transcript, for answers about the meeting. */
  context: () => string;
  /** Add an action item to the running meeting's minutes. */
  addAction: (task: string) => void;
  /** "Jarvisi, ukonči meeting". */
  end: () => void;
  /** "Jarvisi, přejmenuj meeting na …". */
  rename: (title: string) => void;
};

export function useJarvis(shapeshift: RefObject<ShapeshiftController | null>, meeting?: MeetingHooks) {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const conn = useRef<Conn | null>(null);
  const t0 = useRef(0);
  // The user's words since Jarvis last spoke: what a delegation is about.
  const turn = useRef({ text: "", jarvisSpoke: false });
  const history = useRef<string[]>([]);
  const agentThread = useRef<string | undefined>(undefined);
  const jev = useRef(new Map<string, Promise<IntentResult | null>>());
  const speculate = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Save/discard done straight from the transcript, before (or without) a delegation.
  const done = useRef(new Map<string, Promise<string>>());
  // handle() calls itself for "…, ulož to", and preview() calls it early.
  const handleRef = useRef<(utterance: string) => Promise<string>>(async () => "");
  // Requests run one at a time, so "ulož to" waits for the card it saves.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((utterance: string) => {
    const run = queue.current.then(() => handleRef.current(utterance));
    queue.current = run.catch(() => undefined);
    return run;
  }, []);
  // Work started while the user is still talking (Gemini tidy/revise, quick answers), by kind:utterance.
  const early = useRef(new Map<string, Promise<unknown>>());
  // A peer connection with its offer already gathered, so a session starts ~0.2 s sooner.
  const prepared = useRef<{ pc: RTCPeerConnection; dc: RTCDataChannel; mic: MediaStream; at: number } | null>(null);
  const meetingRef = useRef(meeting);
  useEffect(() => {
    meetingRef.current = meeting;
  });
  // preview() hangs up on "vypni se" (set once cleanup exists).
  const hangUpRef = useRef<() => void>(() => undefined);
  // handle() hangs up before switching to another page.
  const stopRef = useRef<() => void>(() => undefined);
  // "dej mi do kalendáře, že…" [pause] "zítra vyzvednout balík": the destination carries over (15 s).
  const pendingTarget = useRef<{ intent: CardIntent; at: number } | null>(null);
  // "Zruš" then "Zruš to" from the growing transcript is one command, not two.
  const lastCommand = useRef<{ action: string; at: number; result: string } | null>(null);
  // The agent just read out an email and asked whether to send it: "ano"/"ne" is for the agent.
  const agentAsked = useRef(false);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((l) => {
      const last = l[l.length - 1];
      if ((kind === "you" || kind === "jarvis") && last?.kind === kind) return [...l.slice(0, -1), { ...last, text: last.text + text }];
      return [...l, { at: Math.round(performance.now() - t0.current), ts: Date.now(), kind, text }];
    });
  }, []);

  /** Silent mode: a command is confirmed by a chime, and Jarvis's voice is held back for a moment. */
  const ack = useCallback(() => {
    if (getVerbosity() !== "silent") return;
    chime("ready");
    const c = conn.current;
    if (!c) return;
    c.audio.muted = true;
    setTimeout(() => conn.current === c && (c.audio.muted = false), 3500);
  }, []);

  /** Cards live in the Shapeshift input and its saved list, exactly as if typed. */
  const show = useCallback((c: Card) => shapeshift.current?.show(c.text, c.intent), [shapeshift]);

  // What Jarvis said last, for Jev's context.
  const lastSaid = useRef("");
  // The card the preview put on screen for an utterance: it isn't "the card on screen" for that same utterance.
  const shownFor = useRef<string | null>(null);
  /** What's on screen and what Jarvis just said, so Jev understands "to", "tam", "jo". */
  const jevContext = useCallback(() => {
    const shown = shapeshift.current?.current();
    return [
      shown?.text.trim() && shown.intent ? `Na obrazovce je karta (${registry[shown.intent].label}): „${shown.text}“.` : "Na obrazovce není žádná karta.",
      lastSaid.current ? `Jarvis naposledy řekl: „${lastSaid.current.slice(-200)}“.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [shapeshift]);

  /** Jev once per distinct text, with the context as it was the first time (preview and delegation share it). */
  const classifyOnce = useCallback(
    (text: string) => {
      const key = text.trim().toLowerCase();
      let p = jev.current.get(key);
      if (!p) {
        p = classify(text, undefined, jevContext()).catch(() => null);
        jev.current.set(key, p);
        if (jev.current.size > 50) jev.current.delete(jev.current.keys().next().value!);
      }
      return p;
    },
    [jevContext],
  );

  /** Run `work` once per kind+utterance; the preview can start it, the delegation reuses it. */
  const once = useCallback(<T,>(kind: string, utterance: string, work: () => Promise<T>): Promise<T> => {
    const k = `${kind}:${keyOf(utterance)}`;
    let p = early.current.get(k) as Promise<T> | undefined;
    if (!p) {
      p = work();
      early.current.set(k, p);
      if (early.current.size > 40) early.current.delete(early.current.keys().next().value!);
    }
    return p;
  }, []);

  const postCard = (body: object) =>
    fetch("/api/card", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((b: { text?: string }) => b.text ?? null)
      .catch(() => null);

  /** Straight from Calendar/Tasks/Keep/meetings, or null (then the agent answers). */
  const quick = useCallback(
    (utterance: string, topic: string) =>
      once(`quick-${topic}`, utterance, async () => {
        const { from, to } = periodFor(utterance);
        const res = await fetch("/api/quick", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic, from: from.toISOString(), to: to.toISOString(), completed: ASKS_DONE.test(utterance) }),
        }).catch(() => null);
        const body = (await res?.json().catch(() => null)) as { facts?: string | null } | null;
        return body?.facts ?? null;
      }),
    [once],
  );

  /** While the user is still talking: preview the card they are dictating. */
  const preview = useCallback(
    (utterance: string) => {
      if (speculate.current) clearTimeout(speculate.current);
      speculate.current = setTimeout(async () => {
        // "vypni se": off right away, before Jarvis says anything (on a meeting only when addressed).
        if (isHangUp(utterance) && (!meetingRef.current || /jarvis/i.test(lastSentence(utterance)))) {
          hangUpRef.current();
          return;
        }
        // "začni meeting" / "ukonči meeting": act on the words alone, even if Jarvis never delegates it.
        if (OPEN_TOOL.some(([re]) => re.test(utterance)) || (meetingRef.current && END_MEETING.test(utterance) && /jarvis/i.test(utterance))) {
          const key = utterance.trim().toLowerCase();
          if (!done.current.has(key)) done.current.set(key, enqueue(utterance));
          return;
        }
        const text = cardText(utterance);
        if (utterance.trim().length < 3) return;
        const shownBefore = shapeshift.current?.current();
        const r = await classifyOnce(utterance);
        if (!r || turn.current.text !== utterance) return; // stale
        // Jev heard "that's all": off now.
        if (wantsHangUp(r, utterance) && !meetingRef.current) {
          hangUpRef.current();
          return;
        }
        // Jev: this is about the card on screen (save, discard, move it): do it now.
        const onScreen = shownBefore?.text.trim() && shownBefore.intent ? { text: shownBefore.text, intent: shownBefore.intent } : null;
        if (!meetingRef.current && !agentAsked.current && cardVerdict(r, utterance, onScreen)) {
          const key = utterance.trim().toLowerCase();
          if (!done.current.has(key)) done.current.set(key, enqueue(utterance));
          return;
        }
        const d = decide(r);
        if (d.action === "create" && r.intent.value !== "none" && text.length >= 3) {
          shownFor.current = utterance.trim().toLowerCase();
          show(buildCard(text, r, targetOf(r, utterance) ?? undefined));
          if (needsCleanup(text)) void once("clean", utterance, () => postCard({ utterance: text }));
        }
        // Get the slow parts going now; the delegation picks them up when it arrives.
        const shown = shapeshift.current?.current();
        if (d.action === "update" && shown?.text.trim()) void once("revise", utterance, () => postCard({ card: shown.text, change: utterance }));
        const topic = topicOf(r, utterance);
        if (d.action === "ask" && topic) void quick(utterance, topic);
        // "ulož to" / "zruš to" act at once; the delegation then just reports it.
        if ((d.action === "save" || d.action === "discard") && d.actionConfidence >= 0.9 && utterance.split(/\s+/).length <= 6) {
          const key = utterance.trim().toLowerCase();
          if (!done.current.has(key)) done.current.set(key, enqueue(utterance));
        }
      }, 250);
    },
    [classifyOnce, enqueue, once, quick, shapeshift, show],
  );

  /** Do what the user asked; returns what Jarvis should say. */
  const handle = useCallback(
    async (utterance: string): Promise<string> => {
      const v = verbosityCommand(lastSentence(utterance));
      if (v) {
        setVerbosity(v);
        const dc = conn.current?.dc;
        if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "session.instructions.append", delegation_id: null, content: VERBOSITY_INSTRUCTIONS[v] }));
        push("tool", `řeč: ${VERBOSITY_LABEL[v]}`);
        if (v === "silent") ack();
        return v === "silent" ? "Tichý režim zapnutý. Nic neříkej." : v === "brief" ? "Stručně. Řekni jen „Dobře.“" : "Normálně. Řekni jen „Dobře.“";
      }
      if (isHangUp(utterance) && (!meeting || /jarvis/i.test(lastSentence(utterance)))) {
        hangUpRef.current();
        return "Uživatel tě vypnul. Nic neříkej.";
      }
      // Only when addressed: people also say "ukončíme to" to each other.
      if (meeting && END_MEETING.test(utterance) && /jarvis/i.test(utterance)) {
        push("tool", "končím meeting");
        setTimeout(() => meeting.end(), 2500);
        return "Končím meeting a připravuji zápis. Rozlouč se krátce.";
      }
      const rename = meeting ? utterance.match(RENAME_MEETING) : null;
      if (meeting && rename) {
        const t = rename[1].trim().replace(/^[„"']|[“"']$/g, "");
        meeting.rename(t.charAt(0).toUpperCase() + t.slice(1));
        return `Meeting se teď jmenuje „${t}“.`;
      }
      const tool = OPEN_TOOL.find(([re]) => re.test(utterance));
      if (tool) {
        push("tool", `otevírám ${tool[1]}`);
        // Let Jarvis say it, then hang up and switch pages (the meeting starts recording there).
        setTimeout(() => {
          stopRef.current();
          window.location.assign(tool[1]);
        }, 2500);
        return tool[2];
      }
      // A dictation that ends with "ulož to": make the card, then save it.
      const tail = utterance.match(TRAILING_COMMAND);
      if (tail && tail[1].split(/\s+/).length >= 2) {
        const first = await handleRef.current(tail[1]);
        return `${first} ${await handleRef.current(tail[2])}`;
      }
      const jev = await classifyOnce(utterance);
      if (!jev) return "Aplikace teď neodpovídá, zkus to prosím znovu.";
      if (wantsHangUp(jev, utterance) && (!meeting || /jarvis/i.test(lastSentence(utterance)))) {
        hangUpRef.current();
        return "Uživatel tě vypnul. Nic neříkej.";
      }
      // The card on screen (unless the preview just made it from these same words).
      const onScreen = shapeshift.current?.current();
      const key = utterance.trim().toLowerCase();
      const card = !meeting && onScreen?.text.trim() && onScreen.intent && shownFor.current !== key ? { text: onScreen.text, intent: onScreen.intent } : null;
      const verdict = agentAsked.current ? null : cardVerdict(jev, utterance, card);
      if (verdict && card) {
        const kind = verdict.kind;
        const last = lastCommand.current;
        if (last && Date.now() - last.at < 5000 && last.action === kind) return last.result;
        if (kind === "move") shapeshift.current?.show(card.text, verdict.to);
        const ok = kind === "discard" ? (shapeshift.current?.discard(), true) : shapeshift.current?.save();
        const result = !ok
          ? "Kartu se nepodařilo uložit."
          : kind === "move"
            ? `Přesunuto a uloženo do ${DESTINATION[verdict.to] ?? "Googlu"}. Řekni jen „Hotovo.“`
            : "Hotovo. Řekni jen „Hotovo.“";
        ack();
        push("tool", `Jev: ${kind}${kind === "move" ? ` → ${verdict.to}` : ""} (karta na obrazovce ${Math.round((jev.aboutShown ?? 0) * 100)} %)`);
        lastCommand.current = { action: kind, at: Date.now(), result };
        return result;
      }
      // A destination with nothing to put there: move the card just saved, or remember it for the next sentence.
      const named = meeting ? null : targetOf(jev, utterance, card?.intent);
      const leftover = leftoverWords(utterance);
      if (named && !leftover && !card) {
        const recent = savedItems.getSnapshot()[0];
        if (recent && Date.now() - recent.createdAt < 10 * 60_000 && recent.intent !== named && (jev.aboutShown ?? 1) >= 0.4) {
          // The sync sees the new kind and moves it in Google (removes the old, writes the new).
          const c = buildCard(recent.text, jev, named);
          savedItems.update((list) => list.map((x) => (x.id === recent.id ? { ...x, intent: named, summary: c.summary } : x)));
          ack();
          return `Přesunuto do ${DESTINATION[named] ?? "Googlu"}. Řekni jen „Hotovo.“`;
        }
        pendingTarget.current = { intent: named, at: Date.now() };
        return "Poslouchám, co tam mám zapsat? Řekni jen „Co tam mám dát?“";
      }
      // The destination the user named (or said just before a pause) decides the card kind.
      const carried = pendingTarget.current && Date.now() - pendingTarget.current.at < 15_000 ? pendingTarget.current.intent : null;
      pendingTarget.current = null;
      const target = named ?? carried;
      const r = target && jev.intent.value !== target && (jev.action?.value === "create" || jev.action?.value === "update" || !jev.action)
        ? { ...jev, intent: { ...jev.intent, value: target }, action: jev.action && { ...jev.action, value: "create" as const } }
        : jev;
      // "zavolat mámě je hotové", "odškrtni mléko": checking off a task in Google, not a card edit.
      // A question about it ("jaké mám splněné úkoly?") is not that: it goes the quick way below.
      const asking = /\?\s*$|^(a\s+)?(jak\p{L}*|co|kter\p{L}*|kolik|kdy|mám|mam|máme|mame|jsou|je)(?![\p{L}])/iu.test(utterance.trim());
      const checkOff =
        !asking &&
        /(?<![\p{L}])(hotov[éáýo]?|splněn[éáýo]?|splnen[eayo]?|odškrtni|odskrtni|zaškrtni|zaskrtni|vyřízen[éáýo]?|vyrizen[eayo]?|udělal jsem|udelal jsem|mám hotovo|mam hotovo)(?![\p{L}])/iu.test(utterance);
      const replyToAgent = (agentAsked.current && /^(\S+\s+){0,5}\S*$/.test(utterance.trim())) || checkOff;
      const { action } = replyToAgent ? { action: "ask" as const } : decide(r);
      push("tool", `Jev: ${action} · ${r.intent.value}${r.askTopic && r.askTopic.value !== "none" ? ` · téma ${r.askTopic.value}` : ""} (${Math.round((r.action?.confidence ?? 0) * 100)} %)`);
      const last = lastCommand.current;
      if ((action === "save" || action === "discard") && last?.action === action && Date.now() - last.at < 5000) return last.result;
      const remember = (result: string) => {
        lastCommand.current = { action, at: Date.now(), result };
        return result;
      };
      // The card in the input: from voice or typed by hand.
      const shown = shapeshift.current?.current();
      const current = shown?.text.trim() && shown.intent ? buildCard(shown.text, r, shown.intent) : null;
      // The card's summary plus the words it was made from, so Jarvis can mention people, place, etc.
      const describe = (c: Card) => `${c.label}: ${c.summary} (z textu „${c.text}“)${DESTINATION[c.intent] ? `, po uložení půjde do ${DESTINATION[c.intent]}` : ""}`;
      // "smaž tu večeři" may mean a saved card rather than the one in the input.
      const saved = action === "update" || action === "discard" ? findSaved(utterance, savedItems.getSnapshot()) : null;
      const aimsAtSaved = !!saved && (!current || (hasContent(utterance) && saved.score > overlap(utterance, current.text)));
      const describeSaved = (x: SavedItem) => `${registry[x.intent].label}: ${x.summary}`;
      // "zruš mi zítra všechny plány", "smaž úkol X": not a card here, so it's for Google (the agent, which asks first).
      const aboutGoogle = /(?<![\p{L}])(kalendář\p{L}*|kalendar\p{L}*|plán\p{L}*|plan\p{L}*|událost\p{L}*|udalost\p{L}*|schůzk\p{L}*|schuzk\p{L}*|meeting\p{L}*|termín\p{L}*|úkol\p{L}*|ukol\p{L}*|tasks?)(?![\p{L}])/iu.test(utterance);
      const toAgent = (action === "discard" || action === "update") && !aimsAtSaved && ((!current && hasContent(utterance)) || (aboutGoogle && !current));

      // On a meeting, a calculation or conversion is answered, not written down.
      if (meeting && action === "create" && ANSWER_CARDS.has(r.intent.value)) {
        const c = buildCard(cardText(utterance), r);
        meeting.activity({ kind: "result", label: c.label, summary: c.summary });
        return `Výsledek (${c.label}): ${c.summary}.`;
      }
      if (meeting && action === "create" && r.intent.value === "timer") {
        const t = parseFor("timer", parseTextFor("timer", cardText(utterance)));
        if (t.seconds) {
          timers.add(timerLabel(t.label), t.seconds);
          meeting.activity({ kind: "timer", label: timerLabel(t.label), seconds: t.seconds });
          return `Časovač ${t.label ? `„${t.label}“ ` : ""}na ${Math.round(t.seconds / 60) || t.seconds} ${t.seconds >= 60 ? "min" : "s"} běží, je vidět na obrazovce. Až doběhne, ozvu se.`;
        }
      }
      if (meeting && (action === "create" || action === "update")) {
        // On a meeting, "zapiš úkol pro Janu…" belongs in the minutes.
        const task = (await once("clean", utterance, () => postCard({ utterance: cardText(utterance) }))) ?? cardText(utterance);
        meeting.addAction(task);
        meeting.activity({ kind: "task", summary: task });
        return `Přidal jsem do zápisu úkol: ${task}.`;
      }

      // "spusť ho" with a timer card in the input starts that timer.
      if (!meeting && current?.intent === "timer" && START.test(utterance) && !hasContent(utterance.replace(START, ""))) {
        const t = parseFor("timer", parseTextFor("timer", current.text));
        if (t.seconds) {
          timers.add(timerLabel(t.label), t.seconds);
          shapeshift.current?.discard();
          ack();
          return `Časovač ${timerLabel(t.label)} běží, je vidět nahoře. Až doběhne, ozvu se.`;
        }
      }
      // "spusť časovač na 5 minut" starts right away; without a start word it's just a card.
      if (!meeting && action === "create" && r.intent.value === "timer" && START.test(utterance)) {
        const t = parseFor("timer", parseTextFor("timer", cardText(utterance)));
        if (t.seconds) {
          timers.add(timerLabel(t.label), t.seconds);
          ack();
          return `Časovač ${timerLabel(t.label)} na ${t.seconds >= 60 ? `${Math.round(t.seconds / 60)} min` : `${t.seconds} s`} běží, je vidět na obrazovce. Až doběhne, ozvu se.`;
        }
      }

      switch (toAgent ? "ask" : action) {
        case "create": {
          let c = buildCard(cardText(utterance), r);
          show(c);
          if (needsCleanup(c.text)) {
            // Show the rough card now, the tidy one when Gemini is done (often already, from the preview).
            const tidy = await once("clean", utterance, () => postCard({ utterance: c.text }));
            if (tidy) {
              c = buildCard(tidy, r);
              show(c);
            }
          }
          ack();
          return `Karta je na obrazovce: ${describe(c)}. Řekni to jednou krátkou větou a na nic se neptej (uložit ji umí uživatel slovem „ulož“).`;
        }
        case "update": {
          if (aimsAtSaved && saved) {
            const res = await fetch("/api/card", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ card: saved.item.text, change: utterance }),
            });
            const body = (await res.json().catch(() => ({}))) as { text?: string };
            if (!body.text) return "Změnu se nepodařilo použít, řekni ji prosím jinak.";
            const r2 = await classifyOnce(body.text);
            const c = r2 ? buildCard(body.text, r2) : buildCard(body.text, r, saved.item.intent);
            savedItems.update((list) => list.map((x) => (x.id === saved.item.id ? { ...x, intent: c.intent, summary: c.summary, text: c.text } : x)));
            return `Uložená karta upravená. Bylo: ${describeSaved(saved.item)}. Teď: ${describe(c)}.`;
          }
          if (!current) {
            const c = buildCard(cardText(utterance), r);
            show(c);
            ack();
            return `Karta je na obrazovce: ${describe(c)}. Řekni to jednou krátkou větou a na nic se neptej.`;
          }
          const revised = await once("revise", utterance, () => postCard({ card: current.text, change: utterance }));
          if (!revised) return "Změnu se nepodařilo použít, řekni ji prosím jinak.";
          const r2 = await classifyOnce(revised);
          const c = r2 ? buildCard(revised, r2) : { ...current, text: revised };
          show(c);
          ack();
          return `Karta upravená, zatím neuložená. ${describe(c)}.`;
        }
        case "save": {
          if (!current || !shapeshift.current?.save()) return remember("Žádná karta k uložení není.");
          ack();
          return remember("Uloženo. Řekni jen „Hotovo.“");
        }
        case "discard": {
          if (aimsAtSaved && saved) {
            savedItems.update((list) => list.filter((x) => x.id !== saved.item.id));
            return remember(`Smazal jsem uloženou kartu ${describeSaved(saved.item)}.`);
          }
          if (!current) return remember(hasContent(utterance) ? "Takovou uloženou kartu nevidím." : "Žádná karta tu není.");
          shapeshift.current?.discard();
          ack();
          return remember("Zahozeno. Řekni jen „Hotovo.“");
        }
        default: {
          const quickTopic = topicOf(r, utterance);
          // On a meeting, "co jsme řešili" means this meeting, not the archive.
          const topic = meeting && quickTopic === "meetings" ? null : quickTopic;
          if (!replyToAgent && !toAgent && topic) {
            const facts = await quick(utterance, topic);
            if (facts) {
              push("tool", `rychlá odpověď: ${topic}`);
              setAnswer(facts);
              meeting?.activity({ kind: "answer", question: utterance, summary: facts });
              return `Údaje (řekni je stručně a přirozeně, časy slovy): ${facts}`;
            }
          }
          const context = [
            meeting ? `Právě probíhá meeting, Jarvis na něm poslouchá. ${meeting.context()}` : "",
            current ? `Na obrazovce je karta ${describe(current)}.` : "",
            savedContext(savedItems.getSnapshot()),
            history.current.length ? `Poslední rozhovor:\n${history.current.slice(-6).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: utterance, context, previousResponseId: agentThread.current }),
          });
          const body = (await res.json().catch(() => ({}))) as { answer?: string; responseId?: string; tools?: string[]; error?: string };
          if (!body.answer) return body.error ?? "Na tohle teď nedokážu odpovědět.";
          agentThread.current = body.responseId;
          // Jarvis read out an e-mail or what it would delete and asked: "ano" / "ne" goes back to the agent.
          agentAsked.current = !!body.tools?.some((t) => t === "google.gmail_prepare" || t === "google.delete_prepare");
          if (body.tools?.length) push("tool", `agent: ${body.tools.join(", ")}`);
          setAnswer(body.answer);
          meeting?.activity({ kind: "answer", question: utterance, summary: body.answer });
          return body.answer;
        }
      }
    },
    [ack, classifyOnce, meeting, once, push, quick, shapeshift, show],
  );
  useEffect(() => {
    handleRef.current = handle;
  });

  const cleanup = useCallback(() => {
    const c = conn.current;
    conn.current = null;
    if (c) clearInterval(c.idle);
    c?.unsubscribe();
    // The answer bubble belongs to the conversation; the transcript keeps it.
    setAnswer(null);
    if (c?.ownMic) c.mic.getTracks().forEach((t) => t.stop());
    c?.dc.close();
    c?.pc.close();
    if (c) c.audio.srcObject = null;
    setStatus("idle");
  }, []);

  /** Get a connection ready (offer + ICE) on the wake word's mic, so "Hey Jarvis" starts faster. Free: no OpenAI call. */
  const prewarm = useCallback(async (mic: MediaStream | null) => {
    if (conn.current || !mic?.getAudioTracks().some((t) => t.readyState === "live")) return;
    const old = prepared.current;
    if (old && old.mic === mic && Date.now() - old.at < 60_000) return;
    prepared.current = null;
    old?.pc.close();
    const pc = new RTCPeerConnection();
    mic.getAudioTracks().forEach((t) => pc.addTrack(t, mic));
    const dc = pc.createDataChannel("oai-events");
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc).catch(() => undefined);
    if (conn.current) return pc.close();
    prepared.current = { pc, dc, mic, at: Date.now() };
  }, []);

  /** Wake Jev up (its first call is slow) while the session is still connecting. */
  const warm = useCallback(() => void classify("dobrý den").catch(() => null), []);

  const start = useCallback(
    async (voice?: string, sharedMic?: MediaStream | null, opts?: { instructions?: string; context?: string; stayOn?: boolean }) => {
      if (conn.current) return;
      setStatus("connecting");
      // Keep earlier conversations in the transcript; timings restart per conversation.
      setAnswer(null);
      turn.current = { text: "", jarvisSpoke: false };
      history.current = [];
      agentThread.current = undefined;
      t0.current = performance.now();
      warm();
      const p = prepared.current;
      prepared.current = null;
      const ready = p && p.mic === sharedMic && Date.now() - p.at < 90_000 && p.pc.signalingState === "have-local-offer" ? p : null;
      if (p && !ready) p.pc.close();
      try {
        const pc = ready?.pc ?? new RTCPeerConnection();
        const audio = new Audio();
        audio.autoplay = true;
        pc.addEventListener("track", (e) => {
          audio.srcObject = new MediaStream([e.track]);
          audio.play().catch(() => push("error", "Prohlížeč zablokoval zvuk, klikni kamkoliv na stránku."));
        });
        const live = sharedMic?.getAudioTracks().some((t) => t.readyState === "live");
        const mic = live && sharedMic ? sharedMic : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!ready) mic.getAudioTracks().forEach((t) => pc.addTrack(t, mic));
        const dc = ready?.dc ?? pc.createDataChannel("oai-events");
        const send = (ev: object) => dc.readyState === "open" && dc.send(JSON.stringify(ev));
        let lastActivity = performance.now();
        const idle = setInterval(() => {
          // A meeting participant stays for the whole meeting.
          if (opts?.stayOn || performance.now() - lastActivity < IDLE_MS || dc.readyState !== "open" || conn.current?.dc !== dc) return;
          push("info", "Nikdo nemluví, končím.");
          send({ type: "session.close" });
        }, 5000);
        // Jarvis knows the saved list, and hears about every change to it.
        const unsubscribe = savedItems.subscribe(() => send({ type: "session.thinking.append", delegation_id: null, content: savedContext(savedItems.getSnapshot()) }));
        conn.current = { pc, dc, mic, ownMic: mic !== sharedMic, audio, idle, unsubscribe };
        let spoken = "";
        let goodbye = false;
        // When the user's words last arrived: a delegation can come before the last few.
        let lastInput = 0;

        dc.addEventListener("message", async ({ data }) => {
          const ev = JSON.parse(data as string);
          if (/transcript\.delta$|delegation\.created$/.test(ev.type)) lastActivity = performance.now();
          switch (ev.type) {
            case "session.started":
              chime("ready");
              if (opts?.instructions) send({ type: "session.instructions.append", delegation_id: null, content: opts.instructions });
              if (!meetingRef.current) send({ type: "session.instructions.append", delegation_id: null, content: VERBOSITY_INSTRUCTIONS[getVerbosity()] });
              send({ type: "session.thinking.append", delegation_id: null, content: opts?.context ?? savedContext(savedItems.getSnapshot()) });
              setStatus("live");
              push("info", "Spojeno, mluv.");
              break;
            case "session.input_transcript.delta": {
              lastInput = performance.now();
              const t = turn.current;
              if (t.jarvisSpoke) {
                if (spoken) history.current.push(`Jarvis: ${spoken.trim()}`);
                spoken = "";
                turn.current = { text: "", jarvisSpoke: false };
              }
              turn.current.text += ev.delta ?? "";
              push("you", ev.delta ?? "");
              preview(turn.current.text);
              break;
            }
            case "session.output_transcript.delta":
              if (!turn.current.jarvisSpoke && turn.current.text.trim()) history.current.push(`Uživatel: ${turn.current.text.trim()}`);
              turn.current.jarvisSpoke = true;
              spoken += ev.delta ?? "";
              lastSaid.current = spoken;
              if (!meetingRef.current && GOODBYE.test(spoken) && !goodbye) {
                goodbye = true;
                setTimeout(() => hangUpRef.current(), 1800);
              }
              // Voice cues like "[clear throat]" are for the speech, not the transcript.
              push("jarvis", (ev.delta ?? "").replace(/\s*\[[^\]]*\]\s*/g, " "));
              break;
            case "session.delegation.created": {
              const id = ev.delegation?.id as string;
              // The words may still be arriving: wait until the transcript is quiet for 350 ms (at most ~1.2 s).
              for (let i = 0; i < 12 && (!turn.current.text.trim() || performance.now() - lastInput < 350); i++) await new Promise((r) => setTimeout(r, 100));
              let utterance = turn.current.text.replace(/\[[^\]]*\]?/g, " ").replace(/\s{2,}/g, " ").trim();
              // On a meeting the buffer holds everyone's talk: keep what follows the last "Jarvisi, …".
              if (meetingRef.current) {
                const at = [...utterance.matchAll(/(?<![\p{L}])(hey\s+)?jarvis\p{L}*/giu)].pop()?.index;
                if (at !== undefined) utterance = utterance.slice(at);
              }
              // These words are handled now; whatever the user says next is a new request.
              turn.current.text = "";
              push("tool", `delegace: „${utterance}“`);
              // "ulož to" may already be done from the transcript: report that instead of redoing it.
              const early = done.current.get(utterance.toLowerCase());
              const result = !utterance ? "Nerozuměl jsem, zopakuj to prosím." : await (early ?? enqueue(utterance));
              push("tool", `→ ${result}`);
              send({ type: "session.commentary.append", delegation_id: id, content: result.slice(0, 1500) });
              break;
            }
            case "session.closed":
              push("info", `Konec (${ev.reason ?? "?"}), ${ev.usage?.seconds ?? "?"} s hovoru.`);
              cleanup();
              break;
            case "error":
              push("error", ev.error?.message ?? JSON.stringify(ev));
              break;
          }
        });
        dc.addEventListener("close", () => conn.current?.dc === dc && cleanup());

        const mark = (what: string) => push("tool", `start: ${what} ${Math.round(performance.now() - t0.current)} ms`);
        if (!ready) {
          await pc.setLocalDescription(await pc.createOffer());
          await gathered(pc);
        }
        mark(ready ? "spojení připravené předem" : "ICE hotovo");
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sdp: pc.localDescription?.sdp, voice }),
        });
        const body = (await res.json()) as { transport?: { sdp: string }; error?: string };
        if (!res.ok || !body.transport) throw new Error(body.error ?? "Nepodařilo se spustit Jarvise.");
        mark("session vytvořena");
        await pc.setRemoteDescription({ type: "answer", sdp: body.transport.sdp });
      } catch (err) {
        push("error", err instanceof DOMException && err.name === "NotAllowedError" ? "Prohlížeč nepovolil mikrofon." : err instanceof Error ? err.message : String(err));
        cleanup();
      }
    },
    [cleanup, enqueue, preview, push, warm],
  );

  /** End gracefully so the session's final usage is reported; hang up anyway after 15 s. */
  const stop = useCallback(() => {
    const c = conn.current;
    if (!c) return;
    if (c.dc.readyState !== "open") return cleanup();
    setStatus("closing");
    c.dc.send(JSON.stringify({ type: "session.close" }));
    setTimeout(() => conn.current === c && cleanup(), 15_000);
  }, [cleanup]);

  useEffect(() => {
    stopRef.current = stop;
    // Immediate: silence the voice now, then close the session (usage still reported if it answers).
    hangUpRef.current = () => {
      const c = conn.current;
      if (!c) return;
      c.audio.muted = true;
      push("info", "Vypnuto.");
      if (c.dc.readyState === "open") c.dc.send(JSON.stringify({ type: "session.close" }));
      setTimeout(() => conn.current === c && cleanup(), 1500);
    };
  }, [stop, cleanup, push]);

  /** Have Jarvis say something unprompted ("časovač doběhl"), if a session is running. */
  const announce = useCallback((text: string) => {
    const dc = conn.current?.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "session.commentary.append", delegation_id: null, content: text }));
    return dc?.readyState === "open";
  }, []);

  return { status, log, answer, start, stop, prewarm, warm, announce };
}
