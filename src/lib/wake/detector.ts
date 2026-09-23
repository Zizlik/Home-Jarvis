/**
 * "Hey Jarvis" wake word, a port of openWakeWord's streaming pipeline
 * (github.com/dscripka/openWakeWord, v0.5.1 utils.py AudioFeatures + model.py).
 *
 * Every 80 ms of 16 kHz audio (1280 samples):
 *   raw audio (+ 480 samples of overlap) → melspectrogram.onnx → 8 mel frames (x/10 + 2)
 *   last 76 mel frames → embedding_model.onnx → one 96-dim embedding
 *   last 16 embeddings → hey_jarvis_v0.1.onnx → score 0..1
 *
 * Runtime-agnostic: pass onnxruntime-web (browser) or onnxruntime-node (tests).
 * Models are CC BY-NC-SA 4.0 (non-commercial); the code is Apache 2.0.
 */

type Tensor = { data: unknown; dims: readonly number[] };
type Session = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> };
export type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => Tensor;
  InferenceSession: { create(model: string | Uint8Array, options?: object): Promise<Session> };
};

export const CHUNK = 1280; // 80 ms at 16 kHz
const OVERLAP = 160 * 3;
const MEL_BINS = 32;
const MEL_WINDOW = 76;
const EMBEDDING = 96;
const WAKE_WINDOW = 16;
/** openWakeWord ignores the first 5 predictions while its buffers fill. */
const WARMUP = 5;

export class WakeDetector {
  private raw = new Float32Array(0);
  private mel: Float32Array[] = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
  private features: Float32Array[] = [];
  private predictions = 0;
  private pending = new Float32Array(0);

  private constructor(
    private ort: Ort,
    private melspec: Session,
    private embedding: Session,
    private wake: Session,
  ) {}

  /** Forget all audio heard so far, so an old "Hey Jarvis" can't fire again. */
  reset() {
    this.raw = new Float32Array(0);
    this.mel = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.features = [];
    this.predictions = 0;
    this.pending = new Float32Array(0);
  }

  /** `load(name)` returns a model path/URL or its bytes, e.g. "/wake/melspectrogram.onnx". */
  static async create(ort: Ort, load: (name: string) => string | Uint8Array | Promise<string | Uint8Array>, options?: object) {
    const open = async (name: string) => ort.InferenceSession.create(await load(name), options);
    const [m, e, w] = await Promise.all([open("melspectrogram.onnx"), open("embedding_model.onnx"), open("hey_jarvis_v0.1.onnx")]);
    return new WakeDetector(ort, m, e, w);
  }

  private async run(s: Session, data: Float32Array, dims: number[]) {
    const out = await s.run({ [s.inputNames[0]]: new this.ort.Tensor("float32", data, dims) });
    return out[s.outputNames[0]].data as Float32Array;
  }

  /**
   * Feed 16 kHz mono PCM on the int16 scale (−32768..32767), any length.
   * Returns the scores of the 80 ms chunks it completed (usually 0 or 1).
   */
  async push(samples: Float32Array): Promise<number[]> {
    const buf = new Float32Array(this.pending.length + samples.length);
    buf.set(this.pending);
    buf.set(samples, this.pending.length);
    const scores: number[] = [];
    let off = 0;
    for (; off + CHUNK <= buf.length; off += CHUNK) scores.push(await this.step(buf.subarray(off, off + CHUNK)));
    this.pending = buf.slice(off);
    return scores;
  }

  private async step(chunk: Float32Array): Promise<number> {
    // Keep just enough raw audio for the overlapping melspectrogram window.
    const raw = new Float32Array(Math.min(this.raw.length, OVERLAP) + CHUNK);
    raw.set(this.raw.subarray(Math.max(0, this.raw.length - OVERLAP)));
    raw.set(chunk, raw.length - CHUNK);
    this.raw = raw;

    const spec = await this.run(this.melspec, raw, [1, raw.length]);
    for (let f = 0; f + MEL_BINS <= spec.length; f += MEL_BINS) {
      const frame = new Float32Array(MEL_BINS);
      for (let i = 0; i < MEL_BINS; i++) frame[i] = spec[f + i] / 10 + 2;
      this.mel.push(frame);
    }
    if (this.mel.length > 970) this.mel.splice(0, this.mel.length - 970);

    const window = new Float32Array(MEL_WINDOW * MEL_BINS);
    this.mel.slice(-MEL_WINDOW).forEach((frame, i) => window.set(frame, i * MEL_BINS));
    this.features.push((await this.run(this.embedding, window, [1, MEL_WINDOW, MEL_BINS, 1])).slice(0, EMBEDDING));
    if (this.features.length > 120) this.features.shift();
    if (this.features.length < WAKE_WINDOW) return 0;

    const input = new Float32Array(WAKE_WINDOW * EMBEDDING);
    this.features.slice(-WAKE_WINDOW).forEach((e, i) => input.set(e, i * EMBEDDING));
    const score = (await this.run(this.wake, input, [1, WAKE_WINDOW, EMBEDDING]))[0];
    return ++this.predictions <= WARMUP ? 0 : score;
  }
}
