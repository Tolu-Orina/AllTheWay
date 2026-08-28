/**
 * Capture: device rate → 16 kHz s16le frames for the Live API.
 *
 * MediaRecorder cannot emit PCM at a fixed rate. This worklet is the capture
 * half of ADR 0006; playback is a sibling processor.
 *
 * Frames are 40ms (640 samples) so a phone socket is not asked to carry 50
 * JSON messages a second — that jitter was audible as dropouts.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._pos = 0;
    this._out = new Int16Array(640); // 40ms at 16k
    this._n = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const step = sampleRate / 16000;
    let pos = this._pos;

    while (pos < channel.length) {
      const i0 = Math.min(channel.length - 1, Math.floor(pos));
      const i1 = Math.min(channel.length - 1, i0 + 1);
      const t = pos - i0;
      const s = channel[i0] + (channel[i1] - channel[i0]) * t;
      const clipped = Math.max(-1, Math.min(1, s));
      this._out[this._n++] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      if (this._n === this._out.length) {
        this.port.postMessage(this._out.slice());
        this._n = 0;
      }
      pos += step;
    }

    this._pos = pos - channel.length;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
