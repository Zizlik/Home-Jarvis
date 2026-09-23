"use client";

import { useCallback, useRef, useState } from "react";
import { buildCard, type Card, describe } from "@/lib/jarvis/cards";

export type JarvisStatus = "idle" | "connecting" | "live" | "closing";
export type LogLine = { at: number; kind: "you" | "jarvis" | "tool" | "info" | "error"; text: string };

type Pending = { callId: string; name: string; args: string };

/**
 * GPT-Live over WebRTC: the mic and Jarvis's voice on media tracks, events on the
 * "oai-events" data channel. Card tools run here, in the browser, on the same
 * Jev + Czech parser pipeline as typing, and their results go back to the backend.
 */
export function useJarvis() {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [log, setLog] = useState<LogLine[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [saved, setSaved] = useState<Card[]>([]);
  const conn = useRef<{ pc: RTCPeerConnection; dc: RTCDataChannel; mic: MediaStream; audio: HTMLAudioElement } | null>(null);
  const cardRef = useRef<Card | null>(null);
  const t0 = useRef(0);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((l) => {
      // Transcript deltas extend the last line of the same speaker.
      const last = l[l.length - 1];
      if ((kind === "you" || kind === "jarvis") && last?.kind === kind && !text.startsWith("\n")) {
        return [...l.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...l, { at: Math.round(performance.now() - t0.current), kind, text: text.replace(/^\n/, "") }];
    });
  }, []);

  const show = useCallback((c: Card | null) => {
    cardRef.current = c;
    setCard(c);
  }, []);

  const runTool = useCallback(
    async ({ name, args }: Pending): Promise<unknown> => {
      const a = (JSON.parse(args || "{}") ?? {}) as { text?: string };
      switch (name) {
        case "create_card":
        case "update_card": {
          if (!a.text) return { chyba: "chybí text" };
          const c = await buildCard(a.text);
          if (!c) return { chyba: "kartu se nepodařilo vytvořit" };
          show(c);
          return describe(c);
        }
        case "save_card": {
          const c = cardRef.current;
          if (!c) return { chyba: "žádná karta není zobrazená" };
          setSaved((s) => [c, ...s]);
          show(null);
          return { uloženo: describe(c) };
        }
        case "discard_card":
          show(null);
          return { zahozeno: true };
        default:
          return { chyba: `neznámý nástroj ${name}` };
      }
    },
    [show],
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
    async (voice = "marin") => {
      if (conn.current) return;
      setStatus("connecting");
      setLog([]);
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

        // Function calls of one backend response; results go back together, then the response continues.
        const calls = new Map<string, Pending[]>();
        const send = (ev: object) => dc.readyState === "open" && dc.send(JSON.stringify(ev));

        dc.addEventListener("message", async ({ data }) => {
          const ev = JSON.parse(data as string);
          switch (ev.type) {
            case "session.started":
              setStatus("live");
              push("info", "Spojeno, mluv.");
              break;
            case "session.input_transcript.delta":
              push("you", ev.delta ?? "");
              break;
            case "session.output_transcript.delta":
              push("jarvis", ev.delta ?? "");
              break;
            case "session.delegation.created":
              push("info", "Jarvis předává úkol backendu…");
              break;
            case "response.event": {
              const inner = ev.event;
              const key = ev.delegation_id as string;
              if (inner?.type === "response.output_item.done" && inner.item?.type === "function_call") {
                const list = calls.get(key) ?? [];
                list.push({ callId: inner.item.call_id, name: inner.item.name, args: inner.item.arguments });
                calls.set(key, list);
              } else if (inner?.type === "response.completed" || inner?.type === "response.done") {
                const list = calls.get(key) ?? [];
                calls.delete(key);
                if (!list.length) break;
                for (const call of list) {
                  push("tool", `${call.name}(${call.args})`);
                  const result = await runTool(call);
                  push("tool", `→ ${JSON.stringify(result)}`);
                  send({ type: "response.item.create", item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(result) } });
                }
                send({ type: "response.create" });
              }
              break;
            }
            case "session.closed":
              push("info", `Konec (${ev.reason ?? "?"}). Využití: ${JSON.stringify(ev.usage ?? {})}`);
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
    [cleanup, push, runTool],
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

  return { status, log, card, saved, start, stop };
}
