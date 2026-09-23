"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { overlap } from "@/lib/jarvis/saved";
import { EMPTY_MINUTES, type MeetingRecord, type Minutes, type Segment } from "@/lib/meeting/minutes";

/** idle → connecting → live → stopping → processing (who spoke + final minutes) → done (review) */
export type MeetingStatus = "idle" | "connecting" | "live" | "stopping" | "processing" | "done";
export type { Segment };

/** Content words in a task (for "is this the same task"). */
const words = (t: string) => t.split(/[^\p{L}\d]+/u).filter((w) => w.length >= 3).length;

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
  /** The meeting's mic, shared with Jarvis when it joins. */
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  /** Diarization label → name, guessed at the end and editable. */
  const [speakers, setSpeakers] = useState<Record<string, string>>({});
  /** What the processing step is doing, for the UI. */
  const [step, setStep] = useState<string | null>(null);

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
  // Action items added by hand or by Jarvis: kept when the model rewrites the minutes.
  const manual = useRef<Minutes["actions"]>([]);
  const keepManual = (m: Minutes): Minutes => {
    // The model often rewords a task Jarvis wrote down ("Jana pošle nabídku…" → "Poslat nabídku… (Jana)"):
    // same if most of the content words match.
    const same = (a: string, b: string) => {
      const n = Math.min(words(a), words(b)) || 1;
      return a.trim().toLowerCase() === b.trim().toLowerCase() || overlap(a, `${b}`) / n >= 0.6;
    };
    const has = (t: string) => m.actions.some((a) => same(t, `${a.task} ${a.owner ?? ""}`));
    return { ...m, actions: [...m.actions, ...manual.current.filter((a) => !has(a.task))] };
  };
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);
  // The recording for "who spoke" (webm/opus at 32 kbps ≈ 0.24 MB a minute; 25 MB ≈ 100 min).
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // stop() reads the latest title and participants.
  const titleRef = useRef(title);
  const participantsRef = useRef(participants);
  useEffect(() => {
    titleRef.current = title;
    participantsRef.current = participants;
  }, [title, participants]);
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
          const merged = keepManual(body.minutes);
          minutesRef.current = merged;
          setMinutes(merged);
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
    const res = await fetch("/api/voice?mode=meeting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names: participantsRef.current }),
    });
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
          const seg: Segment = { at: Math.round((segmentStart.current - t0.current) / 1000), text, speaker: null };
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
    setSpeakers({});
    setEndedAt(null);
    manual.current = [];
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setStream(mic.current);
      chunks.current = [];
      try {
        const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
        recorder.current = new MediaRecorder(mic.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
        recorder.current.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        recorder.current.start(10_000);
      } catch {
        recorder.current = null; // no recording: the live transcript still works, just without speakers
      }
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
    const rec = recorder.current;
    const recorded =
      rec && rec.state !== "inactive"
        ? new Promise<Blob>((resolve) => {
            rec.onstop = () => resolve(new Blob(chunks.current, { type: rec.mimeType }));
            rec.stop();
          })
        : Promise.resolve(null);
    conn.current?.dc.close();
    conn.current?.pc.close();
    conn.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    setStream(null);
    void wakeLock.current?.release().catch(() => undefined);
    if (partialRef.current.trim()) {
      all.current = [...all.current, { at: Math.round((performance.now() - t0.current) / 1000), text: partialRef.current.trim(), speaker: null }];
      setSegments(all.current);
      partialRef.current = "";
      setPartial("");
    }
    setEndedAt(Date.now());
    await minutesBusy.current;
    setStatus("processing");

    // Who spoke: the recording, diarized. Falls back to the live transcript without names.
    const audio = await recorded;
    if (audio?.size) {
      setStep("Rozlišuji, kdo mluvil…");
      const form = new FormData();
      form.set("audio", audio, "meeting.webm");
      const res = await fetch("/api/meeting/diarize", { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { segments?: Segment[]; error?: string } | null;
      if (body?.segments?.length) {
        all.current = body.segments;
        setSegments(body.segments);
      } else if (body?.error) setError(`${body.error} Zápis bude bez jmen.`);
    }

    // The final minutes, from the whole transcript at once, and a guess who A, B, … are.
    setStep("Píšu finální zápis…");
    const res = await fetch("/api/meeting/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: titleRef.current, participants: participantsRef.current, segments: all.current }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { minutes?: Minutes; speakers?: Record<string, string>; error?: string } | null;
    if (body?.minutes) {
      const merged = keepManual(body.minutes);
      minutesRef.current = merged;
      setMinutes(merged);
      setSpeakers(body.speakers ?? {});
      if (!titleRef.current.trim()) setTitle(body.minutes.title);
      // Names the model recognized that weren't listed become participants.
      const named = Object.values(body.speakers ?? {});
      setParticipants((p) => [...p, ...named.filter((n) => !p.includes(n))]);
    } else {
      setError(body?.error ?? "Finální zápis se nepodařilo vytvořit, zůstává průběžný.");
      await updateMinutes();
    }
    setStep(null);
    setStatus("done");
  }, [commit, updateMinutes]);

  /** Add an action item that survives the minutes being rewritten (Jarvis: "zapiš úkol…"). */
  const addAction = useCallback((task: string) => {
    const a = { task, owner: null, due: null };
    manual.current = [...manual.current, a];
    minutesRef.current = { ...minutesRef.current, actions: [...minutesRef.current.actions, a] };
    setMinutes(minutesRef.current);
  }, []);

  const reset = useCallback(() => {
    manual.current = [];
    setStep(null);
    setTitle("");
    setParticipants([]);
    setSpeakers({});
    setEndedAt(null);
    setError(null);
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
      if (recorder.current?.state === "recording") recorder.current.stop();
      conn.current?.pc.close();
      mic.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  /** The meeting as it will be archived, with the user's edits. */
  const record = useCallback(
    (): MeetingRecord | null =>
      startedAt
        ? {
            id: new Date(startedAt).toISOString().replace(/[:.]/g, "-"),
            title: title.trim() || minutes.title || "Meeting",
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt ?? Date.now()).toISOString(),
            participants,
            speakers,
            segments,
            minutes,
          }
        : null,
    [startedAt, endedAt, title, minutes, participants, speakers, segments],
  );

  return {
    status,
    step,
    stream,
    segments,
    partial,
    minutes,
    setMinutes,
    addAction,
    updating,
    error,
    startedAt,
    title,
    setTitle,
    participants,
    setParticipants,
    speakers,
    setSpeakers,
    record,
    start,
    stop,
    reset,
    updateMinutes,
  };
}
