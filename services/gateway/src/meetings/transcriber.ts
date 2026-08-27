/**
 * Turning captured meeting audio into text.
 *
 * `gemini-3.5-transcribe-live-preview`, verified against the real endpoint: the
 * setup below is answered with `setupComplete` and a session id.
 *
 * ## Location: `global`, and this is the opposite of the voice lesson
 *
 * The voice relay had to be moved *off* `global` because the Live conversation
 * model does not exist there — `env.liveLocation` exists for that reason alone.
 * This model is the reverse: `global` is the **only** location that serves it.
 *
 * Reusing `env.liveLocation` here would therefore be wrong in exactly the way
 * that variable was created to prevent, which is why transcription gets its own.
 *
 * ## What this model does and does not do
 *
 * Verified from the model's documentation rather than assumed:
 *
 *   - 85+ languages with **auto-detection**, including mid-session code-mixing.
 *     That is why no language is forced below: someone switching between
 *     English and Yoruba mid-sentence is the case this product cares about, and
 *     pinning a code would defeat it. Hints are passed only when given.
 *   - **Utterance-level timestamps.** Word-level are not supported.
 *   - **No speaker diarization.** An earlier version of this file claimed
 *     otherwise, from documentation describing the *batch* model. The scribe
 *     renders a missing speaker as "Unattributed", which stays the honest
 *     answer here rather than a name nobody can stand behind.
 *   - **Ten minutes of audio per session.** See `SESSION_AUDIO_LIMIT_MS`; a
 *     ninety-minute meeting is nine sessions, rotated underneath the caller.
 */

export interface Utterance {
  at: string;
  /** Absent when the transcriber cannot attribute confidently. Never guessed. */
  speaker?: string;
  text: string;
}

export interface TranscribeEvents {
  onUtterance: (utterance: Utterance) => void;
  onError: (reason: string) => void;
}

export interface TranscribeSession {
  /** 16 kHz s16le, base64 — the frames the capture worklet emits. */
  sendPcm: (base64: string) => void;
  close: () => void;
}

export type TranscriberOpener = (events: TranscribeEvents) => Promise<TranscribeSession>;

export const TRANSCRIBE_MODEL =
  process.env.MEETING_TRANSCRIBE_MODEL || "gemini-3.5-transcribe-live-preview";

/**
 * The only location that serves this model. Deliberately its own variable and
 * not `env.liveLocation`, which is regional for the opposite reason.
 */
export const TRANSCRIBE_LOCATION = process.env.MEETING_TRANSCRIBE_LOCATION || "global";

/** Sample rate of the frames the extension sends. Matches ADR 0006's capture half. */
export const INPUT_HZ = 16_000;

/** Each frame the capture worklet emits. 320 samples at 16 kHz. */
export const FRAME_MS = 20;

/**
 * The model accepts ten minutes of audio in one session.
 *
 * Rotation starts before that rather than at it: a session that hits the limit
 * mid-sentence loses the sentence, and the whole point of rotating early is
 * that nobody notices it happening.
 */
export const SESSION_AUDIO_LIMIT_MS = 10 * 60_000;
export const ROTATE_AFTER_MS = 8.5 * 60_000;

export function liveModelResource(model: string, project: string): string {
  return `projects/${project}/locations/${TRANSCRIBE_LOCATION}/publishers/google/models/${model}`;
}

/**
 * The setup frame for a transcription-only Live session.
 *
 * Three things make it transcribe rather than converse, and each one matters:
 *
 *  - **No tools.** The voice relay declares `plan_turn`, which is how speech
 *    becomes an action. A meeting must never trigger one: the people talking
 *    have not asked this product for anything, and an overheard "just send it
 *    to them" is not an instruction.
 *  - **No automatic activity detection.** With VAD on, the model decides a turn
 *    has ended and answers it. Disabled, it never takes a turn — so it listens
 *    and cannot speak, which is FR-C4 enforced by configuration rather than by
 *    hoping a prompt holds.
 *  - **TEXT, never AUDIO.** There is no voice to emit even if it tried.
 */
export function transcribeSetup(
  model: string,
  project: string,
  languageCodes: string[] = [],
): Record<string, unknown> {
  return {
    setup: {
      model: liveModelResource(model, project),
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription:
        // Empty means auto-detect across 85+ languages, including switching
        // mid-sentence. Hints only narrow it, so they are sent only when the
        // caller actually has one.
        languageCodes.length > 0 ? { languageCodes } : {},
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: true },
      },
      // Deliberately absent: `tools`, and any system instruction inviting a
      // reply. There is nothing here for the model to do but transcribe.
    },
  };
}
