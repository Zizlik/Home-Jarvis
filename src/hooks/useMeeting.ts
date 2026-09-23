"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_MINUTES, type Minutes } from "@/lib/meeting/minutes";

export type MeetingStatus = "idle" | "connecting" | "live" | "stopping" | "done";
export type Segment = { at: number; text: string };

/** A pause this long ends a segment (committed for its final transcript). */
const PAUSE_MS = 2000;
/** Nonstop talk is still cut into segments this long. */
const MAX_SEGMENT_MS = 30_000;
/** How often the minutes are rewritten while the meeting runs. */
const MINUTES_EVERY_MS = 60_000;

type Conn = { pc: RTCPeerConnection; dc: RTCDataChannel };

/**
 * Meeting mode: the mic goes to realtime transcription (gpt-live-transcribe, no
 * voice model, ~1 $/h), the transcript is cut into segments at pauses, and the
 * minutes are rewritten every minute from the new segments (/api/meeting/minutes).
 * A dropped connection reconnects on its own; the transcript carries on.
 */
export function useMeeting() {
  const [status, setStatus] = useState<MeetingStatus>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partial, setPartial] = useState("");
  const [minutes, setMinutes] = useState<Minutes>(EMPTY_MINUTES);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const mic = useRef<MediaStream | null>(null);
  const conn = useRef<Conn | null>(null);
  const running = useRef(false);
  const t0 = useRef(0);
  const partialRef = useRef("");
  const segmentStart = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const all = useRef<Segment[]>([]);
  // Segments already folded into the minutes.
  const summarized = useRef(0);
  const minutesRef = useRef<Minutes>(EMPTY_MINUTES);
  const minutesBusy = useRef<Promise<void> | null>(null);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);
  // connect() reconnects itself when a session drops.
  const reconnect = useRef<() => Promise<void>>(async () => undefined);

  const commit = useCallback(() => {
    const c = conn.current;
    if (c?.dc.readyState === "open" && partialRef.current.trim()) c.dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }, []);

  /** Fold the segments since the last update into the minutes. */
  const updateMinutes = useCallback(() => {
    if (minutesBusy.current) return minutesBusy.current;
    const fresh = all.current.slice(summarized.current);
    if (!fresh.length) return Promise.resolve();
    const upto = all.current.length;
    setUpdating(true);
    minutesBusy.current = (async () => {
      try {
        const res = await fetch("/api/meeting/minutes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ minutes: summarized.current ? minutesRef.current : null, transcript: fresh.map((s) => s.text).join("\n") }),
        });
        const body = (await res.json().catch(() => ({}))) as { minutes?: Minutes; error?: string };
        if (body.minutes) {
          minutesRef.current = body.minutes;
          setMinutes(body.minutes);
          summarized.current = upto;
        } else setError(body.error ?? "Zápis se nepodařilo aktualizovat.");
      } finally {
        setUpdating(false);
        minutesBusy.current = null;
      }
    })();
    return minutesBusy.current;
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/voice?mode=meeting", { method: "POST" });
    const body = (await res.json()) as { secret?: string; error?: string };
    if (!res.ok || !body.secret) throw new Error(body.error ?? "Přepis se nepodařilo spustit.");
    const pc = new RTCPeerConnection();
    mic.current!.getAudioTracks().forEach((t) => pc.addTrack(t, mic.current!));
    const dc = pc.createDataChannel("oai-events");
    conn.current = { pc, dc };

    dc.onmessage = (e) => {
      const ev = JSON.parse(e.data as string) as { type: string; delta?: string; transcript?: string; error?: { message?: string } };
      if (ev.type === "conversation.item.input_audio_transcription.delta" && ev.delta) {
        if (!partialRef.current) segmentStart.current = performance.now();
        partialRef.current += ev.delta;
        setPartial(partialRef.current);
        if (pauseTimer.current) clearTimeout(pauseTimer.current);
        pauseTimer.current = setTimeout(commit, PAUSE_MS);
        if (performance.now() - segmentStart.current > MAX_SEGMENT_MS) commit();
      } else if (ev.type === "conversation.item.input_audio_transcription.completed") {
        const text = (ev.transcript ?? partialRef.current).trim();
        partialRef.current = "";
        setPartial("");
        if (text) {
          const seg = { at: Math.round((segmentStart.current - t0.current) / 1000), text };
          all.current = [...all.current, seg];
          setSegments(all.current);
        }
      } else if (ev.type === "error") {
        console.warn("[meeting]", ev.error?.message);
      }
    };
    dc.onclose = () => {
      if (conn.current?.dc !== dc) return;
      conn.current = null;
      pc.close();
      // Sessions don't last forever: pick up where we left off.
      if (running.current) {
        setError("Spojení s přepisem se přerušilo, připojuji znovu…");
        void reconnect
          .current()
          .then(() => setError(null))
          .catch((err: Error) => setError(err.message));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: { authorization: `Bearer ${body.secret}`, "content-type": "application/sdp" },
    });
    if (!sdp.ok) throw new Error("Spojení s přepisem selhalo.");
    await pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
  }, [commit]);
  useEffect(() => {
    reconnect.current = connect;
  }, [connect]);

  const start = useCallback(async () => {
    if (running.current) return;
    setStatus("connecting");
    setError(null);
    all.current = [];
    summarized.current = 0;
    minutesRef.current = EMPTY_MINUTES;
    setSegments([]);
    setMinutes(EMPTY_MINUTES);
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      running.current = true;
      t0.current = performance.now();
      await connect();
      setStartedAt(Date.now());
      setStatus("live");
      // Keep the screen (and the mic) awake for the whole meeting.
      wakeLock.current = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
        ?.request("screen")
        .catch(() => null) ?? null;
    } catch (err) {
      running.current = false;
      mic.current?.getTracks().forEach((t) => t.stop());
      setStatus("idle");
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Prohlížeč nepovolil mikrofon." : err instanceof Error ? err.message : String(err));
    }
  }, [connect]);

  /** Finish: last words, last minutes update, then the review screen. */
  const stop = useCallback(async () => {
    if (!running.current) return;
    setStatus("stopping");
    commit();
    await new Promise((r) => setTimeout(r, 2500));
    running.current = false;
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    conn.current?.dc.close();
    conn.current?.pc.close();
    conn.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    void wakeLock.current?.release().catch(() => undefined);
    if (partialRef.current.trim()) {
      all.current = [...all.current, { at: Math.round((performance.now() - t0.current) / 1000), text: partialRef.current.trim() }];
      setSegments(all.current);
      partialRef.current = "";
      setPartial("");
    }
    await minutesBusy.current;
    await updateMinutes();
    setStatus("done");
  }, [commit, updateMinutes]);

  const reset = useCallback(() => {
    all.current = [];
    summarized.current = 0;
    minutesRef.current = EMPTY_MINUTES;
    setSegments([]);
    setMinutes(EMPTY_MINUTES);
    setStartedAt(null);
    setStatus("idle");
  }, []);

  // Minutes every minute while live.
  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => void updateMinutes(), MINUTES_EVERY_MS);
    return () => clearInterval(id);
  }, [status, updateMinutes]);

  // Leaving the page ends the meeting's mic.
  useEffect(
    () => () => {
      running.current = false;
      conn.current?.pc.close();
      mic.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { status, segments, partial, minutes, setMinutes, updating, error, startedAt, start, stop, reset, updateMinutes };
}
