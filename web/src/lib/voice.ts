import { TurnEventSchema, type TurnEvent } from "@alltheway/contracts";

import { authHeader } from "@/lib/api";

/**
 * Voice socket to the gateway, not to Gemini.
 *
 * Same origin split as the turn stream: Firebase Hosting cannot carry a
 * WebSocket (ADR 0001 + 0006), so production points at the gateway hostname
 * via VITE_STREAM_ORIGIN. Auth is the first message, not a query string.
 */

const STREAM_ORIGIN = import.meta.env.VITE_STREAM_ORIGIN ?? "";

export const INPUT_HZ = 16_000;
export const OUTPUT_HZ = 24_000;

export type VoiceReady = {
  model: string;
  inputHz: number;
  outputHz: number;
  fake?: true;
};

export type VoiceHandlers = {
  onReady?: (ready: VoiceReady) => void;
  onPcm?: (pcm: Int16Array) => void;
  onInterrupted?: () => void;
  onTranscript?: (side: "user" | "model", text: string, finished: boolean) => void;
  onTurn?: (event: TurnEvent | unknown) => void;
  onError?: (message: string) => void;
  onClose?: (reason: string) => void;
};

export type VoiceLine = {
  id: number;
  side: "user" | "model";
  text: string;
  finished: boolean;
};

export function captionsFromThread(
  thread: Array<{ role: string; text: string }>,
): VoiceLine[] {
  const out: VoiceLine[] = [];
  for (const m of thread) {
    const text = m.text.trim();
    if (!text) continue;
    const side = m.role === "user" ? "user" : "model";
    out.push({
      id: (out[out.length - 1]?.id ?? 0) + 1,
      side,
      text,
      finished: true,
    });
  }
  return out;
}

/**
 * Same fold as the gateway (`protocol.ts`). Kept here so an older relay
 * that still forwards raw chunks does not overwrite the line on screen.
 */
export function foldTranscript(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  let overlap = 0;
  const limit = Math.min(current.length, incoming.length);
  for (let n = limit; n > 0; n--) {
    if (current.slice(current.length - n) === incoming.slice(0, n)) {
      overlap = n;
      break;
    }
  }
  return current + incoming.slice(overlap);
}

export function applyVoiceCaption(
  lines: VoiceLine[],
  side: "user" | "model",
  text: string,
  finished: boolean,
): VoiceLine[] {
  const next = lines.slice();
  let open = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].side === side && !next[i].finished) {
      open = i;
      break;
    }
  }
  if (open >= 0) {
    const folded = foldTranscript(next[open].text, text);
    next[open] = { ...next[open], text: folded || next[open].text, finished };
    return next;
  }
  const last = [...next].reverse().find((l) => l.side === side);
  if (last?.finished && finished) {
    const folded = foldTranscript(last.text, text);
    if (folded === last.text || last.text.startsWith(text) || text === last.text) {
      return next;
    }
  }
  if (!text && finished) return next;
  const id = (next[next.length - 1]?.id ?? 0) + 1;
  next.push({ id, side, text, finished });
  return next;
}

function bytesToPcm(b64: string): Int16Array {
  const bin = atob(b64);
  const even = bin.length - (bin.length % 2);
  const buf = new ArrayBuffer(even);
  const view = new Uint8Array(buf);
  for (let i = 0; i < even; i++) view[i] = bin.charCodeAt(i);
  return new Int16Array(buf);
}

function pcmToB64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export type VoiceSocket = {
  sendPcm: (pcm: Int16Array) => void;
  hangup: () => void;
};

const BACKOFF_MS = [300, 800, 1600, 3200];

export async function openVoiceSocket(
  sessionId: string,
  handlers: VoiceHandlers,
  opts?: { signal?: AbortSignal },
): Promise<VoiceSocket> {
  const token = (await authHeader()).authorization?.replace(/^Bearer\s+/i, "") ?? "";
  let handle: string | undefined;
  let closed = false;
  let ws: WebSocket | undefined;
  let attempt = 0;

  const hangup = () => {
    closed = true;
    try {
      ws?.send(JSON.stringify({ hangup: true }));
    } catch {
      /* already gone */
    }
    ws?.close();
  };

  opts?.signal?.addEventListener("abort", hangup);

  const connect = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new DOMException("aborted", "AbortError"));
      const url = `${STREAM_ORIGIN.replace(/^http/, "ws") || wsOrigin()}/api/voice/live`;
      const socket = new WebSocket(url);
      ws = socket;

      socket.addEventListener("open", () => {
        attempt = 0;
        socket.send(
          JSON.stringify({
            auth: { token, sessionId, resumeHandle: handle },
          }),
        );
      });

      socket.addEventListener("message", (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.ready && typeof msg.ready === "object") {
          handlers.onReady?.(msg.ready as VoiceReady);
          resolve();
          return;
        }
        if (typeof msg.pcm === "string") {
          handlers.onPcm?.(bytesToPcm(msg.pcm));
          return;
        }
        if (msg.interrupted) {
          handlers.onInterrupted?.();
          return;
        }
        if (typeof msg.resumeHandle === "string" && msg.resumeHandle) {
          handle = msg.resumeHandle;
          return;
        }
        const transcript = msg.transcript as
          | { side?: "user" | "model"; text?: string; finished?: boolean }
          | undefined;
        if (transcript?.side && typeof transcript.text === "string") {
          handlers.onTranscript?.(transcript.side, transcript.text, transcript.finished === true);
          return;
        }
        if (msg.turn) {
          const parsed = TurnEventSchema.safeParse(msg.turn);
          handlers.onTurn?.(parsed.success ? parsed.data : msg.turn);
          return;
        }
        const err = msg.error as { message?: string } | undefined;
        if (err?.message) {
          handlers.onError?.(err.message);
          reject(new Error(err.message));
          return;
        }
        const closing = msg.closing as { reason?: string } | undefined;
        if (typeof closing?.reason === "string" && closing.reason) {
          // Deliberate end — spoken hang-up or Stop. Must not reconnect:
          // a dropped socket retries, a hang-up must idle the overlay.
          closed = true;
          handlers.onClose?.(closing.reason);
          try {
            socket.close();
          } catch {
            /* already closing */
          }
          return;
        }
      });

      socket.addEventListener("error", () => {
        /* close handler reconnects */
      });

      socket.addEventListener("close", (ev) => {
        if (closed) {
          // Already notified via `{ closing }` or the client hangup() path.
          // Calling onClose again would start a second drain.
          return;
        }
        if (ev.code === 4000) {
          closed = true;
          handlers.onClose?.("hangup");
          return;
        }
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        if (attempt > BACKOFF_MS.length) {
          handlers.onError?.("The voice connection dropped. You can keep typing.");
          closed = true;
          reject(new Error("voice reconnect exhausted"));
          return;
        }
        window.setTimeout(() => {
          void connect().catch(() => undefined);
        }, wait);
      });
    });

  await connect();

  return {
    sendPcm(pcm) {
      if (closed || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ pcm: pcmToB64(pcm) }));
    },
    hangup,
  };
}

function wsOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/^http/, "ws");
}
