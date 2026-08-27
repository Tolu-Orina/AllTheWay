import { GoogleAuth } from "google-auth-library";
import { WebSocket } from "ws";

import { liveWebSocketUrl } from "../voice/protocol.js";
import { env } from "../env.js";
import {
  FRAME_MS,
  ROTATE_AFTER_MS,
  TRANSCRIBE_LOCATION,
  TRANSCRIBE_MODEL,
  transcribeSetup,
  type TranscribeEvents,
  type TranscribeSession,
} from "./transcriber.js";

/**
 * The Live API, configured to transcribe and nothing else.
 *
 * Two properties of this model shape everything here, and both were learned
 * from its documentation rather than discovered in production:
 *
 * ## 1. Audio before `setupComplete` is lost, and worse
 *
 * The documentation is explicit: streaming audio before the server sends
 * `setup_complete` "can cause the session to cancel unexpectedly and may result
 * in empty transcriptions, particularly on short audio clips".
 *
 * That is a nasty failure to debug — the socket is open, frames are being
 * accepted, and nothing ever comes back. So frames are buffered until the
 * server says it is ready, and only then flushed.
 *
 * ## 2. Ten minutes per session, and meetings are ninety
 *
 * One session accepts ten minutes of audio. A meeting is nine of them. So a
 * session is rotated at eight and a half minutes of *audio sent* — not wall
 * clock, because a muted meeting sends nothing and would otherwise rotate for
 * no reason.
 *
 * The replacement is opened and confirmed **before** the old one is closed, so
 * there is no window where frames have nowhere to go. If it fails to open, the
 * caller is told; it is not left silently transcribing nothing.
 */

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const CONNECT_TIMEOUT_MS = 20_000;
const SETUP_TIMEOUT_MS = 20_000;

interface Leg {
  socket: WebSocket;
  /** Milliseconds of audio handed to this session. */
  audioMs: number;
  ready: boolean;
  pending: string[];
}

function extractText(message: Record<string, unknown>): string {
  const server = (message.serverContent ?? message.server_content) as
    | Record<string, unknown>
    | undefined;
  const transcription = (server?.inputTranscription ?? server?.input_transcription) as
    | Record<string, unknown>
    | undefined;
  const text = transcription?.text;
  return typeof text === "string" ? text : "";
}

/** One Live session. Resolves once the server has confirmed setup. */
async function openLeg(events: TranscribeEvents, languageCodes: string[]): Promise<Leg> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error("no credential for transcription");

  // `global`, which is the only location that serves this model — and the
  // opposite of the voice relay's regional requirement.
  const socket = new WebSocket(liveWebSocketUrl(TRANSCRIBE_LOCATION), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const leg: Leg = { socket, audioMs: 0, ready: false, pending: [] };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out opening the session")), CONNECT_TIMEOUT_MS);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  socket.send(JSON.stringify(transcribeSetup(TRANSCRIBE_MODEL, env.projectId, languageCodes)));

  socket.on("message", (data) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const error = message.error as { message?: string } | undefined;
    if (error?.message) {
      events.onError(error.message.slice(0, 200));
      return;
    }

    if (message.setupComplete ?? message.setup_complete) {
      leg.ready = true;
      // Everything captured while waiting. Dropping it instead would lose the
      // opening seconds of every meeting — which is where people say what the
      // meeting is about.
      for (const frame of leg.pending.splice(0)) sendFrame(leg, frame);
      return;
    }

    const text = extractText(message).trim();
    if (!text) return;

    events.onUtterance({
      at: new Date().toISOString(),
      // No speaker: this model does not diarize. "Unattributed" downstream is
      // the honest rendering, and better than a name nobody can stand behind.
      text,
    });
  });

  socket.on("error", (error) => events.onError((error as Error).message.slice(0, 200)));

  // Wait for the server to confirm before letting any audio near it.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the session was never confirmed")), SETUP_TIMEOUT_MS);
    const check = setInterval(() => {
      if (!leg.ready) return;
      clearInterval(check);
      clearTimeout(timer);
      resolve();
    }, 25);
    socket.once("close", () => {
      clearInterval(check);
      clearTimeout(timer);
      reject(new Error("the session closed before it was ready"));
    });
  });

  return leg;
}

function sendFrame(leg: Leg, base64: string): void {
  if (leg.socket.readyState !== WebSocket.OPEN) return;
  leg.socket.send(
    JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }],
      },
    }),
  );
  leg.audioMs += FRAME_MS;
}

export async function openLiveTranscriber(
  events: TranscribeEvents,
  languageCodes: string[] = [],
): Promise<TranscribeSession> {
  let leg = await openLeg(events, languageCodes);
  let rotating = false;
  let closed = false;

  async function rotate(): Promise<void> {
    if (rotating || closed) return;
    rotating = true;

    const previous = leg;
    try {
      // Opened and confirmed before the old one goes, so frames always have
      // somewhere to land. The overlap is deliberate.
      leg = await openLeg(events, languageCodes);
      previous.socket.close();
    } catch (error) {
      // The old session still has some capacity left, so keep using it rather
      // than dropping audio — but say so, because it will hit its limit soon.
      events.onError(
        `Could not renew the transcription session (${(error as Error).message}). ` +
          "Notes may stop shortly.",
      );
    } finally {
      rotating = false;
    }
  }

  return {
    sendPcm(base64) {
      if (closed) return;

      if (!leg.ready) {
        // Bounded: roughly twenty seconds of audio. A session that never
        // confirms must not grow a buffer until the instance dies.
        if (leg.pending.length < 1000) leg.pending.push(base64);
        return;
      }

      sendFrame(leg, base64);

      // Measured in audio sent, not wall clock: a muted meeting sends nothing
      // and has no reason to rotate.
      if (leg.audioMs >= ROTATE_AFTER_MS) void rotate();
    },
    close() {
      closed = true;
      if (leg.socket.readyState === WebSocket.OPEN) leg.socket.close();
    },
  };
}
