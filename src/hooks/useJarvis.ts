"use client";

import { useCallback, useRef, useState } from "react";
import { buildCard, type Card, cardText, classify, decide } from "@/lib/jarvis/cards";
import type { IntentResult } from "@/lib/jev/types";

export type JarvisStatus = "idle" | "connecting" | "live" | "closing";
export type LogLine = { at: number; kind: "you" | "jarvis" | "tool" | "info" | "error"; text: string };

type Conn = { pc: RTCPeerConnection; dc: RTCDataChannel; mic: MediaStream; audio: HTMLAudioElement };

/**
 * GPT-Live over WebRTC with client delegation: Jarvis talks, the app does the work.
 * While the user speaks, Jev reads the running transcript so the card forms live.
 * When Jarvis delegates, Jev's answer decides what to do (new card, change, save,
 * discard) in ~0.3 s; only questions go to a model (/api/agent, with MCP tools).
 */
export function useJarvis() {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [draft, setDraft] = useState(false);
  const [saved, setSaved] = useState<Card[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const conn = useRef<Conn | null>(null);
  const cardRef = useRef<Card | null>(null);
  const t0 = useRef(0);
  // The user's words since Jarvis last spoke: what a delegation is about.
  const turn = useRef({ text: "", jarvisSpoke: false });
  const history = useRef<string[]>([]);
  const agentThread = useRef<string | undefined>(undefined);
  const jev = useRef(new Map<string, Promise<IntentResult | null>>());
  const speculate = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((l) => {
      const last = l[l.length - 1];
      if ((kind === "you" || kind === "jarvis") && last?.kind === kind) return [...l.slice(0, -1), { ...last, text: last.text + text }];
      return [...l, { at: Math.round(performance.now() - t0.current), kind, text }];
    });
  }, []);

  const show = useCallback((c: Card | null, isDraft = false) => {
    cardRef.current = c;
    setCard(c);
    setDraft(isDraft);
  }, []);

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
        if (text.length < 3) return;
        const r = await classifyOnce(utterance);
        if (!r || turn.current.text !== utterance) return; // stale
        const d = decide(r);
        if (d.action === "create" && r.intent.value !== "none") show(buildCard(text, r), true);
      }, 250);
    },
    [classifyOnce, show],
  );

  /** Do what the user asked; returns what Jarvis should say. */
  const handle = useCallback(
    async (utterance: string): Promise<string> => {
      const r = await classifyOnce(utterance);
      if (!r) return "Aplikace teď neodpovídá, zkus to prosím znovu.";
      const { action } = decide(r);
      push("tool", `Jev: ${action} · ${r.intent.value} (${Math.round((r.action?.confidence ?? 0) * 100)} %)`);
      const current = cardRef.current;
      // The card's summary plus the words it was made from, so Jarvis can mention people, place, etc.
      const describe = (c: Card) => `${c.label}: ${c.summary} (z textu „${c.text}“)`;

      switch (action) {
        case "create": {
          const c = buildCard(cardText(utterance), r);
          show(c);
          return `Zobrazená karta, zatím neuložená. ${describe(c)}.`;
        }
        case "update": {
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
          if (!current) return "Žádná karta k uložení není.";
          setSaved((s) => [current, ...s]);
          show(null);
          return `Uloženo. ${describe(current)}.`;
        }
        case "discard": {
          if (!current) return "Žádná karta tu není.";
          show(null);
          return "Karta zahozená.";
        }
        default: {
          const context = [
            current ? `Na obrazovce je karta ${describe(current)}.` : "",
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
    [classifyOnce, push, show],
  );

  const cleanup = useCallback(() => {
    const c = conn.current;
    conn.current = null;
    c?.mic.getTracks().forEach((t) => t.stop());
    c?.dc.close();
    c?.pc.close();
    if (c) c.audio.srcObject = null;
    setStatus("idle");
  }, []);

  const start = useCallback(
    async (voice?: string) => {
      if (conn.current) return;
      setStatus("connecting");
      setLog([]);
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
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        mic.getAudioTracks().forEach((t) => pc.addTrack(t, mic));
        const dc = pc.createDataChannel("oai-events");
        conn.current = { pc, dc, mic, audio };
        const send = (ev: object) => dc.readyState === "open" && dc.send(JSON.stringify(ev));
        let spoken = "";

        dc.addEventListener("message", async ({ data }) => {
          const ev = JSON.parse(data as string);
          switch (ev.type) {
            case "session.started":
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
              const utterance = turn.current.text.trim();
              push("tool", `delegace: „${utterance}“`);
              const result = utterance ? await handle(utterance) : "Nerozuměl jsem, zopakuj to prosím.";
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
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sdp: pc.localDescription?.sdp, voice }),
        });
        const body = (await res.json()) as { transport?: { sdp: string }; error?: string };
        if (!res.ok || !body.transport) throw new Error(body.error ?? "Nepodařilo se spustit Jarvise.");
        await pc.setRemoteDescription({ type: "answer", sdp: body.transport.sdp });
      } catch (err) {
        push("error", err instanceof DOMException && err.name === "NotAllowedError" ? "Prohlížeč nepovolil mikrofon." : err instanceof Error ? err.message : String(err));
        cleanup();
      }
    },
    [cleanup, handle, preview, push],
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

  return { status, log, card, draft, saved, answer, start, stop };
}
