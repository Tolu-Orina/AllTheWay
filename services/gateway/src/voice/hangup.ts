/**
 * Spoken hang-up: the model asked to leave, the socket has not closed yet.
 *
 * Vertex Live has no hang-up API. `GoAway` is a ten-minute cap, not goodbye.
 * The live model calls `end_this_conversation`; we close the same way the
 * browser Stop button does, but only after the farewell has been sent — and
 * after a short drain so the browser can play the last PCM.
 *
 * Closing on the tool call itself cuts the goodbye. Barge-in must cancel:
 * they said bye, then kept talking.
 */

export const END_THIS_CONVERSATION = "end_this_conversation";

export type HangupDelays = {
  /** No farewell audio after the tool: close rather than wait the watchdog. */
  silentMs: number;
  /** After the last farewell PCM / turnComplete, let the worklet play it. */
  playoutMs: number;
  /** Missing turnComplete must not leave the microphone live. */
  watchdogMs: number;
};

export const DEFAULT_HANGUP_DELAYS: HangupDelays = {
  silentMs: 1_800,
  playoutMs: 1_600,
  watchdogMs: 5_000,
};

/**
 * Read at arm time. Tests shorten this; production leaves the defaults.
 */
export const hangupDelays: HangupDelays = { ...DEFAULT_HANGUP_DELAYS };

export function setHangupDelaysForTests(partial: Partial<HangupDelays>): () => void {
  const previous = { ...hangupDelays };
  Object.assign(hangupDelays, { ...DEFAULT_HANGUP_DELAYS, ...partial });
  return () => {
    Object.assign(hangupDelays, previous);
  };
}

/**
 * Returned to Vertex so it will speak after the tool. Vertex Live often stays
 * mute after a function response unless the result tells it to talk.
 *
 * Not a turn, not a confirm, not a plan. Leaving is not yes.
 */
export const HANGUP_TOOL_RESULT = {
  status: "ending",
  will_hangup: true,
  instruction:
    "Speak a short farewell in their language now, then stop speaking. Do not ask a question. Do not wait. This is not a yes to any pending plan.",
} as const;

export class SpokenHangup {
  private callId: string | undefined;
  private heardPcm = false;
  private fired = false;
  private silent: ReturnType<typeof setTimeout> | undefined;
  private playout: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly hangup: () => void,
    private readonly delays: HangupDelays = hangupDelays,
  ) {}

  get pending(): boolean {
    return this.callId !== undefined && !this.fired;
  }

  get settled(): boolean {
    return this.fired;
  }

  /** True if this call was armed; duplicate tool calls should not re-arm. */
  arm(callId: string): boolean {
    if (this.fired || this.callId) return false;
    this.callId = callId;
    this.heardPcm = false;
    this.watchdog = setTimeout(() => this.fire(), this.delays.watchdogMs);
    this.silent = setTimeout(() => this.fire(), this.delays.silentMs);
    return true;
  }

  onPcm(): void {
    if (!this.pending) return;
    this.heardPcm = true;
    this.clear(this.silent);
    this.silent = undefined;
    // Trailing audio after the tool call: Gemini can emit `toolCall` and then
    // more PCM. If we already scheduled close, push it out so we do not cut
    // the goodbye.
    if (this.playout) {
      this.clear(this.playout);
      this.playout = setTimeout(() => this.fire(), this.delays.playoutMs);
    }
  }

  onTurnComplete(): void {
    if (!this.pending) return;
    this.clear(this.silent);
    this.silent = undefined;
    this.clear(this.playout);
    const wait = this.heardPcm ? this.delays.playoutMs : this.delays.silentMs;
    this.playout = setTimeout(() => this.fire(), wait);
  }

  onInterrupted(): void {
    this.cancel();
  }

  onCancel(ids: string[]): void {
    if (this.callId && ids.includes(this.callId)) this.cancel();
  }

  dispose(): void {
    this.clearAll();
    this.callId = undefined;
    this.heardPcm = false;
  }

  private cancel(): void {
    if (this.fired) return;
    this.clearAll();
    this.callId = undefined;
    this.heardPcm = false;
  }

  private fire(): void {
    if (this.fired) return;
    this.fired = true;
    this.clearAll();
    this.hangup();
  }

  private clear(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer) clearTimeout(timer);
  }

  private clearAll(): void {
    this.clear(this.silent);
    this.clear(this.playout);
    this.clear(this.watchdog);
    this.silent = undefined;
    this.playout = undefined;
    this.watchdog = undefined;
  }
}
