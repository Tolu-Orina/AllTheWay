import type express from "express";

import { env } from "./env.js";

/**
 * Server-Sent Events, written by hand.
 *
 * ## Why this is not behind Firebase Hosting
 *
 * Firebase Hosting applies a **60-second request timeout to rewrites** that is
 * documented and not configurable. A long-lived stream through a Hosting
 * rewrite is therefore severed at 60s with a 504, independently of any
 * buffering behaviour at the CDN. (Firebase has also stated that rewrites
 * buffer streaming responses entirely, though that claim is thinner — one
 * forum post, unrefreshed. The timeout alone is disqualifying.)
 *
 * So `/api/**` stays behind Hosting and the stream is served from the gateway's
 * own hostname. That split is deliberate, and it is why `env.webOrigins` and
 * the CORS handling below exist.
 *
 * ## Why the anti-buffering headers are still set
 *
 * They do nothing for Hosting, but every other hop honours them — a load
 * balancer, a corporate proxy, a service mesh. `no-transform` in particular is
 * the standard signal that a middlebox must not recompress, and compression is
 * the usual reason a stream arrives all at once.
 */

const HEARTBEAT_MS = 15_000;

export type Stream = {
  /** One named event. Data is JSON, one `data:` line, always flushed. */
  send: (event: unknown) => void;
  /** True once the client has gone away and writing is pointless. */
  closed: () => boolean;
  end: () => void;
};

/** Reflects an allowed origin only. An unlisted origin gets no CORS headers. */
export function applyCors(req: express.Request, res: express.Response): void {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !env.webOrigins.includes(origin)) return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("vary", "origin");
}

export function openStream(req: express.Request, res: express.Response): Stream {
  applyCors(req, res);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    // no-transform is the one that stops a proxy recompressing (and so
    // buffering) the body; no-store keeps it out of any cache along the way.
    "cache-control": "no-cache, no-store, no-transform",
    connection: "keep-alive",
    // nginx and several managed proxies honour this; harmless where nothing does.
    "x-accel-buffering": "no",
  });
  // Get the headers onto the wire now, so the browser's fetch resolves and the
  // UI can switch into its streaming state before the first event exists.
  res.flushHeaders();

  let closed = false;

  // A comment line. Keeps idle intermediaries from reaping a connection that is
  // simply waiting on a slow model, and costs one line every 15 seconds.
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  const shut = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
  };

  // The client navigating away is the normal ending, not an error. Without this
  // the generator upstream keeps pulling from the agent for a reader that left.
  req.on("close", shut);
  res.on("close", shut);

  return {
    send(event) {
      if (closed) return;
      // JSON is single-line, so one data: line is always enough. Splitting on
      // newlines would be required for arbitrary text.
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    closed: () => closed,
    end() {
      if (closed) return;
      shut();
      res.end();
    },
  };
}
