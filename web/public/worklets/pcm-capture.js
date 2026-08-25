/**
 * Capture: device rate → 16 kHz s16le frames for the Live API.
 *
 * MediaRecorder cannot emit PCM at a fixed rate. This worklet is the capture
 * half of ADR 0006; playback is a sibling processor.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frac = 0;
    this._prev = 0;
    this._out = new Int16Array(320); // 20ms at 16k
    this._n = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const step = sampleRate / 16000;
    let i = 0;
    let frac = this._frac;
    let prev = this._prev;

    while (i < channel.length) {
      const s = channel[i];
      frac += 1;
      if (frac >= step) {
        frac -= step;
        const t = frac / step;
        const mixed = prev + (s - prev) * (1 - t);
        const clipped = Math.max(-1, Math.min(1, mixed));
        this._out[this._n++] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
        if (this._n === this._out.length) {
          this.port.postMessage(this._out.slice());
          this._n = 0;
        }
      }
      prev = s;
      i++;
    }

    this._frac = frac;
    this._prev = prev;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
