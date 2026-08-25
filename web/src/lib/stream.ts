import { TurnEventSchema, type TurnEvent } from "@alltheway/contracts";

import { authHeader } from "@/lib/api";

/**
 * Reads a turn as it happens.
 *
 * ## Why not EventSource
 *
 * `EventSource` cannot set request headers, so the Firebase ID token would have
 * to travel in the query string — where it lands in browser history, in proxy
 * logs, and in any Referer sent onward. `fetch` with a `ReadableStream` reads
 * the same SSE bytes and keeps the token in an `Authorization` header, which is
 * the whole reason the rest of the client is safe. The cost is parsing the
 * framing by hand, which is a dozen lines.
 *
 * It also gives us a real `AbortSignal`. EventSource reconnects on its own,
 * which for a turn would silently re-run the plan.
 *
 * ## Why the origin is configurable
 *
 * The stream cannot be served through a Firebase Hosting rewrite: Hosting
 * imposes a documented, unconfigurable 60-second request timeout on rewrites
 * that severs a long-lived stream. So in production the stream goes straight to
 * the gateway's own hostname while everything else stays behind Hosting. In
 * development this is empty and Vite proxies it, same-origin.
 */
const STREAM_ORIGIN = import.meta.env.VITE_STREAM_ORIGIN ?? "";

export type TurnStreamOptions = {
  signal?: AbortSignal;
  onEvent: (event: TurnEvent) => void;
};

/** Splits an SSE buffer into complete frames, returning the unconsumed tail. */
function drainFrames(buffer: string, emit: (frame: string) => void): string {
  let rest = buffer;
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) return rest;
    emit(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
  }
}

export async function streamTurn(
  sessionId: string,
  message: string,
  { signal, onEvent }: TurnStreamOptions,
): Promise<void> {
  const url =
    `${STREAM_ORIGIN}/api/sessions/${encodeURIComponent(sessionId)}/turn/stream` +
    `?message=${encodeURIComponent(message)}`;

  const res = await fetch(url, {
    headers: { accept: "text/event-stream", ...(await authHeader()) },
    signal,
    // Named so the intent survives: the gateway is a different origin in
    // production, and the token rides in a header rather than a cookie.
    credentials: "omit",
  });

  if (!res.ok || !res.body) {
    // A failure before the stream opens is still an ordinary HTTP failure, so
    // it is reported the same way. Once the body starts, errors arrive in-band
    // as `{ kind: "error" }` instead.
    onEvent({ kind: "error", message: "Could not reach the planner. Try again." });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  const handleFrame = (frame: string) => {
    for (const line of frame.split("\n")) {
      // `: keep-alive` heartbeats are comments and carry nothing.
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const parsed = TurnEventSchema.safeParse(JSON.parse(raw));
        // An event shape the client does not recognise is dropped rather than
        // guessed at — a later server may add event kinds this build predates.
        if (parsed.success) onEvent(parsed.data);
      } catch {
        /* a malformed frame is not worth tearing the turn down for */
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      buffer = drainFrames(buffer, handleFrame);
    }
    // A final frame with no trailing blank line still counts.
    if (buffer.trim()) handleFrame(buffer);
  } catch (err) {
    // Aborting is how this ends when the user navigates away; it is not a fault.
    if ((err as Error)?.name !== "AbortError") {
      onEvent({ kind: "error", message: "The connection to the planner dropped." });
    }
  } finally {
    reader.releaseLock();
  }
}
