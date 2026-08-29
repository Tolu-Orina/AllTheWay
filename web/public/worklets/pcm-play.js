/**
 * Playback: 24 kHz s16le from the Live API → device rate, with a short jitter
 * buffer. `interrupted` from the server is a flush of this queue.
 *
 * After the first start, a brief underrun is silence — not a restart of the
 * 100ms pre-buffer. Resetting on the first empty quantum made a jittery phone
 * socket start-stop-start, which is the dropout people hear as "audio issues".
 */
class PcmPlayProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._offset = 0;
    this._started = false;
    this._target = Math.floor(sampleRate * 0.1); // ~100ms before we start
    this._queued = 0;
    this._starve = 0;
    this._draining = false;
    this._drainPosted = false;
    this.port.onmessage = (ev) => {
      if (ev.data === "flush") {
        this._queue = [];
        this._offset = 0;
        this._started = false;
        this._queued = 0;
        this._starve = 0;
        this._draining = false;
        this._drainPosted = false;
        return;
      }
      if (ev.data === "drain") {
        this._draining = true;
        this._drainPosted = false;
        this._postDrainedIfIdle();
        return;
      }
      const src = ev.data;
      if (!(src instanceof Int16Array) && !ArrayBuffer.isView(src)) return;
      const samples = src instanceof Int16Array ? src : new Int16Array(src.buffer);
      const ratio = sampleRate / 24000;
      const out = new Float32Array(Math.max(0, Math.floor(samples.length * ratio)));
      for (let i = 0; i < out.length; i++) {
        const x = i / ratio;
        const i0 = Math.min(samples.length - 1, Math.floor(x));
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const t = x - i0;
        const a = samples[i0] / 0x8000;
        const b = samples[i1] / 0x8000;
        out[i] = a + (b - a) * t;
      }
      this._queue.push(out);
      this._queued += out.length;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;

    if (!this._started) {
      if (this._queued < this._target) {
        out.fill(0);
        return true;
      }
      this._started = true;
      this._starve = 0;
    }

    let written = 0;
    while (written < out.length) {
      if (this._queue.length === 0) {
        out.fill(0, written);
        this._starve += out.length - written;
        if (this._starve > sampleRate * 0.04) {
          this._started = false;
          this._starve = 0;
        }
        break;
      }
      this._starve = 0;
      const frame = this._queue[0];
      const take = Math.min(out.length - written, frame.length - this._offset);
      out.set(frame.subarray(this._offset, this._offset + take), written);
      this._offset += take;
      written += take;
      this._queued -= take;
      if (this._offset >= frame.length) {
        this._queue.shift();
        this._offset = 0;
      }
    }
    this._postDrainedIfIdle();
    return true;
  }

  _postDrainedIfIdle() {
    if (!this._draining || this._drainPosted) return;
    if (this._queued > 0) return;
    this._drainPosted = true;
    this.port.postMessage({ drained: true });
  }
}

registerProcessor("pcm-play", PcmPlayProcessor);
