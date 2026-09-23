// Mic capture for the wake word: posts 16 kHz mono frames on the int16 scale.
// The AudioContext runs at 16 kHz, so the browser does the resampling.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1280);
    this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.len++] = Math.max(-1, Math.min(1, ch[i])) * 32767;
      if (this.len === this.buf.length) {
        this.port.postMessage(this.buf);
        this.buf = new Float32Array(1280);
        this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
