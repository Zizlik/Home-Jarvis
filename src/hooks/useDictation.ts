"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/lib/notify";

export type DictationStatus = "idle" | "connecting" | "listening" | "finishing";

type Session = { pc: RTCPeerConnection; dc: RTCDataChannel; stream: MediaStream };

/**
 * Push-to-talk dictation over OpenAI realtime transcription (WebRTC).
 * `onText` receives the running transcript of the current recording; the caller
 * decides where it goes (the input). Start and stop are both a click on the mic.
 */
export function useDictation(onText: (transcript: string, final: boolean) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const session = useRef<Session | null>(null);
  const transcript = useRef({ done: "", partial: "" });
  const stopping = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const close = useCallback(() => {
    const s = session.current;
    session.current = null;
    s?.stream.getTracks().forEach((t) => t.stop());
    s?.dc.close();
    s?.pc.close();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    setStatus("connecting");
    transcript.current = { done: "", partial: "" };
    stopping.current = false;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const res = await fetch("/api/voice", { method: "POST" });
      const body = (await res.json()) as { secret?: string; error?: string };
      if (!res.ok || !body.secret) throw new Error(body.error ?? "Nepodařilo se spustit mikrofon.");

      const pc = new RTCPeerConnection();
      pc.addTrack(stream.getAudioTracks()[0], stream);
      const dc = pc.createDataChannel("oai-events");
      session.current = { pc, dc, stream };

      dc.onmessage = (e) => {
        const ev = JSON.parse(e.data as string) as { type: string; delta?: string; transcript?: string; error?: { message?: string } };
        const t = transcript.current;
        if (ev.type === "conversation.item.input_audio_transcription.delta" && ev.delta) {
          t.partial += ev.delta;
          onTextRef.current(`${t.done}${t.partial}`.trim(), false);
        } else if (ev.type === "conversation.item.input_audio_transcription.completed") {
          // A note in the input reads better without the sentence-final period.
          t.done = `${t.done}${(ev.transcript ?? t.partial).trim().replace(/[.…]+$/u, "")} `;
          t.partial = "";
          onTextRef.current(t.done.trim(), true);
          if (stopping.current && session.current?.dc === dc) close();
        } else if (ev.type === "error") {
          console.warn("[voice]", ev.error?.message);
        }
      };
      dc.onopen = () => setStatus("listening");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { authorization: `Bearer ${body.secret}`, "content-type": "application/sdp" },
      });
      if (!sdp.ok) throw new Error("Spojení s přepisem selhalo.");
      await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      close();
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Prohlížeč nepovolil mikrofon."
          : err instanceof Error
            ? err.message
            : "Mikrofon nejde spustit.";
      notify(msg, { id: "voice" });
    }
  }, [close]);

  /** Stop recording: commit the audio so the final transcript arrives, then hang up. */
  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.stream.getTracks().forEach((t) => (t.enabled = false));
    if (s.dc.readyState !== "open") return close();
    setStatus("finishing");
    stopping.current = true;
    s.dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    // The completed event closes the session; don't hang forever if it never comes.
    setTimeout(() => session.current === s && close(), 4000);
  }, [close]);

  useEffect(() => close, [close]);

  return { status, start, stop, toggle: status === "idle" ? start : stop };
}
