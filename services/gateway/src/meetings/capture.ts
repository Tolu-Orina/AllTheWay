import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { uidFromToken } from "../auth.js";
import { routeUpgrade } from "../ws-router.js";
import type { TranscriberOpener, Utterance } from "./transcriber.js";
import { insightDue } from "@alltheway/contracts";

/**
 * Tier 1.5: the meeting the user is already in, captured on their own machine.
 *
 * Tier 2 (Meet Media) needs a Developer Preview this project cannot get into.
 * Tier 1 only reads a transcript after the call. This is the rung between them:
 * the extension captures the meeting tab locally and streams the audio here.
 *
 * ## What makes this acceptable where a bot was not
 *
 * The manifest refuses a headless browser joining as a guest, on the grounds
 * that it is "an unannounced participant in someone else's meeting". Nothing
 * joins here — the audio is what the user is already hearing, on their own
 * device, the way a person taking notes hears it.
 *
 * That answers "not a participant". It does **not** answer "announced", and the
 * difference is the whole ethical weight of this feature: a bot is visible in
 * the participant list, and this is visible to nobody. So disclosure is
 * required to start a session and recorded on the meeting — enforced here,
 * because a checkbox in an extension is a courtesy and this is the boundary.
 *
 * ## Origin is not the control
 *
 * The caller is a `chrome-extension://` origin whose id changes between a
 * locally loaded build and a published one, so pinning it would be
 * configuration that is wrong in one environment by construction. The control
 * is the Firebase ID token in the first frame — the same as the voice relay.
 */

export const CAPTURE_PATH = "/api/meetings/capture";

const AUTH_TIMEOUT_MS = 10_000;

/** A meeting cannot stream forever. Matches the scribe's Phase G cap. */
const MAX_SESSION_MS = 90 * 60_000;

export interface CaptureDeps {
  openTranscriber: TranscriberOpener;
  /**
   * One insight pass over the meeting so far. Optional: a deployment without it
   * still captures notes, which is the part that must not depend on anything.
   */
  runInsights?: (uid: string, transcript: string) => Promise<unknown[]>;
  /** Keeps insights so surfaces other than the extension can read them. */
  onInsights?: (uid: string, meetingId: string, insights: unknown[]) => Promise<void>;
  /** Called with each finished utterance, in order. */
  onUtterance: (uid: string, meetingId: string, utterance: Utterance) => Promise<void>;
  /** Called once when a session opens, so the meeting record exists. */
  onOpen: (uid: string, meetingId: string, title: string) => Promise<void>;
  onClose: (uid: string, meetingId: string) => Promise<void>;
}

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function parse(data: unknown): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(String(data));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function firstMessage(ws: WebSocket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("auth-timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(parse(data));
    });
    ws.once("close", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
  });
}

export function attachCapture(server: Server, deps: CaptureDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  routeUpgrade(server, CAPTURE_PATH, (req: IncomingMessage, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    void handle(ws, deps);
  });

  return wss;
}

async function handle(ws: WebSocket, deps: CaptureDeps): Promise<void> {
  let raw: unknown;
  try {
    raw = await firstMessage(ws, AUTH_TIMEOUT_MS);
  } catch {
    ws.close(4001, "auth_timeout");
    return;
  }

  const auth = (raw as { auth?: Record<string, unknown> } | undefined)?.auth;
  if (!auth || typeof auth.token !== "string" || typeof auth.meetingId !== "string") {
    send(ws, { error: { code: "unauthenticated", message: "Sign in to continue." } });
    ws.close(4001, "bad_auth");
    return;
  }

  const uid = await uidFromToken(auth.token);
  if (!uid) {
    send(ws, { error: { code: "unauthenticated", message: "Sign in to continue." } });
    ws.close(4001, "unauthenticated");
    return;
  }

  // Captured once, so the narrowing above survives into the closures below.
  const user: string = uid;
  const meetingId = auth.meetingId.slice(0, 128);
  const title = typeof auth.title === "string" ? auth.title.slice(0, 200) : "Meeting";

  await deps.onOpen(uid, meetingId, title);

  let session: { sendPcm: (b: string) => void; close: () => void } | undefined;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(cap);
    session?.close();
    void deps.onClose(uid, meetingId);
  };

  // The cap is enforced server-side as well as in the extension. A capture that
  // ran because a client forgot to stop is exactly the cost this bounds, and a
  // client is the one thing that cannot be trusted to bound it.
  const cap = setTimeout(() => {
    send(ws, {
      ended: { reason: "This meeting reached the 90-minute limit. Nothing after this was recorded." },
    });
    finish();
    ws.close(1000, "duration_cap");
  }, MAX_SESSION_MS);


  // The meeting so far, for insight passes. Bounded: an insight reads a recent
  // window, so keeping the whole of a ninety-minute meeting in memory would be
  // holding megabytes to read the last few thousand characters of it.
  let transcript = "";
  const startedAt = Date.now();
  let lastInsightAt: number | null = null;
  let insightRunning = false;

  const elapsedMinutes = () => (Date.now() - startedAt) / 60_000;

  async function maybeInsights(force = false): Promise<void> {
    if (!deps.runInsights || insightRunning || closed) return;

    const elapsed = elapsedMinutes();
    if (!force && !insightDue(elapsed, lastInsightAt)) return;

    insightRunning = true;
    // Recorded before the pass, not after. Scheduling from when a pass *started*
    // is what stops a slow one being followed by a burst of catch-up passes.
    lastInsightAt = elapsed;

    try {
      const insights = await deps.runInsights(user, transcript);
      if (insights.length > 0) {
        send(ws, { insights });
        // Stored after sending: the panel beside the meeting should not wait
        // on a write, and the write is what every other surface reads.
        void deps.onInsights?.(user, meetingId, insights).catch(() => {});
      }
    } catch {
      // Silence. An insight that could not be produced is the ordinary case —
      // most passes find nothing worth saying — and an error banner mid-meeting
      // would be the distraction this feature is trying not to be.
    } finally {
      insightRunning = false;
    }
  }

  try {
    session = await deps.openTranscriber({
      onUtterance(utterance) {
        // Sent back so the extension can show that it is hearing something —
        // a recorder with no visible sign of working is one people stop and
        // restart mid-meeting.
        send(ws, { transcript: { text: utterance.text, at: utterance.at } });

        transcript = `${transcript}
${utterance.text}`.slice(-40_000);
        void maybeInsights();
        void deps.onUtterance(uid, meetingId, utterance).catch(() => {
          // A note that fails to store must not take the session down: the rest
          // of the meeting is still worth capturing.
        });
      },
      onError(reason) {
        send(ws, { error: { code: "upstream_error", message: reason } });
      },
    });
  } catch (error) {
    send(ws, {
      error: {
        code: "upstream_error",
        message: `Transcription is unavailable (${(error as Error).message}).`,
      },
    });
    finish();
    ws.close(1011, "transcriber_unavailable");
    return;
  }

  send(ws, { ready: { meetingId } });

  ws.on("message", (data) => {
    const message = parse(data);
    if (!message) return;

    if (message.end === true) {
      finish();
      ws.close(1000, "ended");
      return;
    }

    if (message.insights === "now") {
      // Asked for, rather than waited for. The schedule widens as a meeting
      // settles, and the moment someone actually wants a check is exactly the
      // moment the next scheduled pass is furthest away.
      void maybeInsights(true);
      return;
    }

    if (typeof message.pcm === "string") {
      session?.sendPcm(message.pcm);
    }
  });

  ws.on("close", finish);
  ws.on("error", finish);
}
