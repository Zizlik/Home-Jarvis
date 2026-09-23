"use client";

import { useEffect, useRef, useState } from "react";
import type { Ort, WakeDetector } from "@/lib/wake/detector";

export type WakeStatus = "off" | "loading" | "needs-click" | "listening" | "error";

const THRESHOLD = 0.5;
const COOLDOWN_MS = 2500;
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

/**
 * Listens for "Hey Jarvis" entirely in the browser (openWakeWord models, onnxruntime-web).
 * Nothing leaves the device until the wake word fires. `stream` is the open mic,
 * reused by the Jarvis session so there is one permission and one mic.
 */
export function useWakeWord(enabled: boolean, paused: boolean, onWake: (mic: MediaStream) => void) {
  const [status, setStatus] = useState<WakeStatus>("off");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    pausedRef.current = paused;
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let mic: MediaStream | null = null;
    let resume: (() => void) | null = null;

    (async () => {
      setStatus("loading");
      try {
        const [ort, { WakeDetector }] = await Promise.all([import("onnxruntime-web"), import("@/lib/wake/detector")]);
        ort.env.wasm.wasmPaths = ORT_WASM;
        ort.env.wasm.numThreads = 1; // threads need cross-origin isolation
        const detector: WakeDetector = await WakeDetector.create(ort as unknown as Ort, (n) => `/wake/${n}`, { executionProviders: ["wasm"] });
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (cancelled) return;
        ctx = new AudioContext({ sampleRate: 16000 });
        await ctx.audioWorklet.addModule("/wake/capture-worklet.js");
        const node = new AudioWorkletNode(ctx, "capture", { numberOfOutputs: 0 });
        ctx.createMediaStreamSource(mic).connect(node);

        // One inference at a time; if the device falls behind, skip old audio.
        let busy = false;
        let queued: Float32Array[] = [];
        let lastWake = 0;
        let stale = false;
        node.port.onmessage = async ({ data }: MessageEvent<Float32Array>) => {
          // While Jarvis talks the detector sleeps; afterwards it starts from a clean slate.
          if (pausedRef.current) {
            stale = true;
            queued = [];
            return;
          }
          if (stale && !busy) {
            detector.reset();
            stale = false;
          }
          queued.push(data);
          if (busy) return;
          busy = true;
          while (queued.length) {
            const frames = queued.length > 8 ? queued.slice(-8) : queued;
            queued = [];
            for (const f of frames) {
              const scores = await detector.push(f);
              if (scores.some((s) => s > THRESHOLD) && Date.now() - lastWake > COOLDOWN_MS && !pausedRef.current) {
                lastWake = Date.now();
                detector.reset();
                queued = [];
                onWakeRef.current(mic!);
                break;
              }
            }
          }
          busy = false;
        };

        setStream(mic);
        // Browsers start audio only after a click or key press on the page.
        if (ctx.state === "suspended") {
          setStatus("needs-click");
          resume = () => {
            void ctx?.resume().then(() => !cancelled && setStatus("listening"));
          };
          window.addEventListener("pointerdown", resume, { once: true });
          window.addEventListener("keydown", resume, { once: true });
        } else setStatus("listening");
      } catch (err) {
        console.warn("[wake]", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (resume) {
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      }
      void ctx?.close();
      mic?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setStatus("off");
    };
  }, [enabled]);

  return { status, stream };
}

/**
 * "heard": one soft blip the moment the wake word fires ("I heard you, connecting").
 * "ready": a rising two-tone when Jarvis is actually listening ("speak now").
 */
export function chime(kind: "heard" | "ready" = "ready") {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    (kind === "heard" ? [520] : [660, 990]).forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.18);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // no audio output: the status in the top bar still shows it
  }
}
