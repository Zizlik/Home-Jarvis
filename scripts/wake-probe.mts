// Scores the "Hey Jarvis" detector on 24 kHz s16le PCM files (e.g. from OpenAI TTS).
// Usage: npx tsx scripts/wake-probe.mts file.pcm…
import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-node";
import { WakeDetector, type Ort } from "../src/lib/wake/detector";

const det = () => WakeDetector.create(ort as unknown as Ort, (n) => `public/wake/${n}`);

function to16k(pcm: Buffer) {
  const src = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const out = new Float32Array(Math.floor((src.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = (i * 3) / 2, a = Math.floor(x), t = x - a;
    out[i] = src[a] * (1 - t) + (src[a + 1] ?? src[a]) * t;
  }
  return out;
}

for (const f of process.argv.slice(2)) {
  const d = await det();
  const silence = new Float32Array(16000);
  const scores = [...(await d.push(silence)), ...(await d.push(to16k(readFileSync(f)))), ...(await d.push(silence))];
  const max = Math.max(...scores);
  console.log(`${f.split("/").pop()?.padEnd(10)} max ${max.toFixed(3)} ${max > 0.5 ? "PROBUDIL" : "-"}`);
}
