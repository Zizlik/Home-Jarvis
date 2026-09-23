"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ShapeshiftController } from "@/components/shapeshift/Shapeshift";
import { buildCard, type Card, cardText, classify, decide } from "@/lib/jarvis/cards";
import type { IntentResult } from "@/lib/jev/types";
import { registry } from "@/components/intents/registry";
import { chime } from "@/hooks/useWakeWord";
import { type SavedItem, savedItems } from "@/lib/savedItems";
import { findSaved, hasContent, overlap } from "@/lib/jarvis/saved";

export type JarvisStatus = "idle" | "connecting" | "live" | "closing";
export type LogLine = { at: number; kind: "you" | "jarvis" | "tool" | "info" | "error"; text: string };

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
  /^(.*\S)[\s,.;!…]+((?:(?:a|tak|no|díky|dík|diky|super|dobře|dobre)[\s,.!]+)*(?:ulož|uloz|uložit|ulozit|zruš|zrus|zrušit|zrusit|zahoď|zahod|smaž|smaz)(?:\s+(?:to|ji|ho|tu kartu|kartu))?)[\s.!…]*$/iu;

/** Long or rambling dictation gets tidied into card text by Gemini (/api/card). */
const needsCleanup = (t: string) => t.split(/\s+/).length > 12 || /…|\.\s+\S.*\.\s+\S/.test(t);

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
export function useJarvis(shapeshift: RefObject<ShapeshiftController | null>) {
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
  // "Zruš" then "Zruš to" from the growing transcript is one command, not two.
  const lastCommand = useRef<{ action: string; at: number; result: string } | null>(null);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((l) => {
      const last = l[l.length - 1];
      if ((kind === "you" || kind === "jarvis") && last?.kind === kind) return [...l.slice(0, -1), { ...last, text: last.text + text }];
      return [...l, { at: Math.round(performance.now() - t0.current), kind, text }];
    });
  }, []);

  /** Cards live in the Shapeshift input and its saved list, exactly as if typed. */
  const show = useCallback((c: Card) => shapeshift.current?.show(c.text, c.intent), [shapeshift]);

  /** Jev once per distinct text: the speculative call and the delegation share it. */
  const classifyOnce = useCallback((text: string) => {
    const key = text.trim().toLowerCase();
    let p = jev.current.get(key);
    if (!p) {
      p = classify(text).catch(() => null);
      jev.current.set(key, p);
      if (jev.current.size > 50) jev.current.delete(jev.current.keys().next().value!);
    }
    return p;
  }, []);

  /** While the user is still talking: preview the card they are dictating. */
  const preview = useCallback(
    (utterance: string) => {
      if (speculate.current) clearTimeout(speculate.current);
      speculate.current = setTimeout(async () => {
        const text = cardText(utterance);
        if (utterance.trim().length < 3) return;
        const r = await classifyOnce(utterance);
        if (!r || turn.current.text !== utterance) return; // stale
        const d = decide(r);
        if (d.action === "create" && r.intent.value !== "none" && text.length >= 3) show(buildCard(text, r));
        // "ulož to" / "zruš to" act at once; the delegation then just reports it.
        if ((d.action === "save" || d.action === "discard") && d.actionConfidence >= 0.9 && utterance.split(/\s+/).length <= 6) {
          const key = utterance.trim().toLowerCase();
          if (!done.current.has(key)) done.current.set(key, enqueue(utterance));
        }
      }, 250);
    },
    [classifyOnce, enqueue, show],
  );

  /** Do what the user asked; returns what Jarvis should say. */
  const handle = useCallback(
    async (utterance: string): Promise<string> => {
      // A dictation that ends with "ulož to": make the card, then save it.
      const tail = utterance.match(TRAILING_COMMAND);
      if (tail && tail[1].split(/\s+/).length >= 2) {
        const first = await handleRef.current(tail[1]);
        return `${first} ${await handleRef.current(tail[2])}`;
      }
      const r = await classifyOnce(utterance);
      if (!r) return "Aplikace teď neodpovídá, zkus to prosím znovu.";
      const { action } = decide(r);
      push("tool", `Jev: ${action} · ${r.intent.value} (${Math.round((r.action?.confidence ?? 0) * 100)} %)`);
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
      const describe = (c: Card) => `${c.label}: ${c.summary} (z textu „${c.text}“)`;
      // "smaž tu večeři" may mean a saved card rather than the one in the input.
      const saved = action === "update" || action === "discard" ? findSaved(utterance, savedItems.getSnapshot()) : null;
      const aimsAtSaved = !!saved && (!current || (hasContent(utterance) && saved.score > overlap(utterance, current.text)));
      const describeSaved = (x: SavedItem) => `${registry[x.intent].label}: ${x.summary}`;

      switch (action) {
        case "create": {
          let c = buildCard(cardText(utterance), r);
          show(c);
          if (needsCleanup(c.text)) {
            // Show the rough card now, the tidy one in ~0.7 s.
            const res = await fetch("/api/card", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ utterance: c.text }),
            }).catch(() => null);
            const body = (await res?.json().catch(() => ({}))) as { text?: string } | undefined;
            if (body?.text) {
              c = buildCard(body.text, r);
              show(c);
            }
          }
          return `Zobrazená karta, zatím neuložená. ${describe(c)}.`;
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
            return `Zobrazená karta, zatím neuložená. ${describe(c)}.`;
          }
          const res = await fetch("/api/card", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ card: current.text, change: utterance }),
          });
          const body = (await res.json().catch(() => ({}))) as { text?: string };
          if (!body.text) return "Změnu se nepodařilo použít, řekni ji prosím jinak.";
          const r2 = await classifyOnce(body.text);
          const c = r2 ? buildCard(body.text, r2) : { ...current, text: body.text };
          show(c);
          return `Karta upravená, zatím neuložená. ${describe(c)}.`;
        }
        case "save": {
          if (!current || !shapeshift.current?.save()) return remember("Žádná karta k uložení není.");
          return remember(`Uloženo. ${describe(current)}.`);
        }
        case "discard": {
          if (aimsAtSaved && saved) {
            savedItems.update((list) => list.filter((x) => x.id !== saved.item.id));
            return remember(`Smazal jsem uloženou kartu ${describeSaved(saved.item)}.`);
          }
          if (!current) return remember(hasContent(utterance) ? "Takovou uloženou kartu nevidím." : "Žádná karta tu není.");
          shapeshift.current?.discard();
          return remember("Karta zahozená.");
        }
        default: {
          const context = [
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
          if (body.tools?.length) push("tool", `agent: ${body.tools.join(", ")}`);
          setAnswer(body.answer);
          return body.answer;
        }
      }
    },
    [classifyOnce, push, shapeshift, show],
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

  const start = useCallback(
    async (voice?: string, sharedMic?: MediaStream | null) => {
      if (conn.current) return;
      setStatus("connecting");
      // Keep earlier conversations in the transcript; timings restart per conversation.
      setAnswer(null);
      turn.current = { text: "", jarvisSpoke: false };
      history.current = [];
      agentThread.current = undefined;
      t0.current = performance.now();
      try {
        const pc = new RTCPeerConnection();
        const audio = new Audio();
        audio.autoplay = true;
        pc.addEventListener("track", (e) => {
          audio.srcObject = new MediaStream([e.track]);
          audio.play().catch(() => push("error", "Prohlížeč zablokoval zvuk, klikni kamkoliv na stránku."));
        });
        const live = sharedMic?.getAudioTracks().some((t) => t.readyState === "live");
        const mic = live && sharedMic ? sharedMic : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        mic.getAudioTracks().forEach((t) => pc.addTrack(t, mic));
        const dc = pc.createDataChannel("oai-events");
        const send = (ev: object) => dc.readyState === "open" && dc.send(JSON.stringify(ev));
        let lastActivity = performance.now();
        const idle = setInterval(() => {
          if (performance.now() - lastActivity < IDLE_MS || dc.readyState !== "open" || conn.current?.dc !== dc) return;
          push("info", "Nikdo nemluví, končím.");
          send({ type: "session.close" });
        }, 5000);
        // Jarvis knows the saved list, and hears about every change to it.
        const unsubscribe = savedItems.subscribe(() => send({ type: "session.thinking.append", delegation_id: null, content: savedContext(savedItems.getSnapshot()) }));
        conn.current = { pc, dc, mic, ownMic: mic !== sharedMic, audio, idle, unsubscribe };
        let spoken = "";

        dc.addEventListener("message", async ({ data }) => {
          const ev = JSON.parse(data as string);
          if (/transcript\.delta$|delegation\.created$/.test(ev.type)) lastActivity = performance.now();
          switch (ev.type) {
            case "session.started":
              chime("ready");
              send({ type: "session.thinking.append", delegation_id: null, content: savedContext(savedItems.getSnapshot()) });
              setStatus("live");
              push("info", "Spojeno, mluv.");
              break;
            case "session.input_transcript.delta": {
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
              // Voice cues like "[clear throat]" are for the speech, not the transcript.
              push("jarvis", (ev.delta ?? "").replace(/\s*\[[^\]]*\]\s*/g, " "));
              break;
            case "session.delegation.created": {
              const id = ev.delegation?.id as string;
              // The words may still be arriving: give the transcript a moment.
              for (let i = 0; i < 6 && !turn.current.text.trim(); i++) await new Promise((r) => setTimeout(r, 50));
              const utterance = turn.current.text.replace(/\[[^\]]*\]?/g, " ").replace(/\s{2,}/g, " ").trim();
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
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.iceGatheringState !== "complete") {
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
        mark("ICE hotovo");
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
    [cleanup, enqueue, preview, push],
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

  return { status, log, answer, start, stop };
}
