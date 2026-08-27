import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { uidFromToken } from "../auth.js";
import { env } from "../env.js";
import { routeUpgrade } from "../ws-router.js";
import { runTurn } from "../orchestrator.js";
import { listPreferences } from "../repos/preferences.js";
import { readUsage, recordUsage } from "../repos/usage.js";
import { recordLine } from "../repos/transcripts.js";
import { ensureSession, touchSession, VOICE_TITLE } from "../repos/sessions.js";
import { createLiveOpener, type LiveOpener } from "./backend.js";
import {
  AUTH_TIMEOUT_MS,
  INPUT_HZ,
  OUTPUT_HZ,
  VOICE_PATH,
  isAuthMessage,
  isPcmMessage,
  type RelayMessage,
} from "./protocol.js";

function originAllowed(origin: string | undefined): boolean {
  // Empty WEB_ORIGINS is development: Vite proxies and the request is
  // same-origin, or the Origin header is the Vite origin talking to :8080.
  if (env.webOrigins.length === 0) return true;
  return typeof origin === "string" && env.webOrigins.includes(origin);
}

/**
 * Store one line, if this user keeps transcripts.
 *
 * Failure is swallowed on purpose. Voice was ephemeral before this existed, so
 * a conversation that cannot be recorded should still be a conversation —
 * dropping the call because a write failed would make the optional feature the
 * fragile one.
 */
async function keep(
  uid: string,
  sessionId: string,
  side: "user" | "model",
  text: string,
): Promise<void> {
  try {
    await recordLine(uid, sessionId, { side, text, at: new Date().toISOString() });
  } catch {
    // Deliberately silent. See above.
  }
}

function send(ws: WebSocket, message: RelayMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function parseJson(data: unknown): unknown {
  try {
    return JSON.parse(String(data));
  } catch {
    return undefined;
  }
}

async function firstMessage(ws: WebSocket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("auth-timeout"));
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(parseJson(data));
    };
    ws.once("message", onMessage);
    ws.once("close", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
  });
}

/**
 * Attach the voice relay to the HTTP server Express is already using.
 *
 * Upgrade happens here rather than inside Express because Express 5 still
 * treats a WebSocket as a request it cannot finish. The path is the only
 * coupling: everything else under `/api` stays HTTP.
 */
export function attachVoice(server: Server, opener: LiveOpener = createLiveOpener()): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Path matching moved to the shared router. This listener used to destroy
  // any socket whose path it did not recognise, which would have torn down
  // the meeting-capture endpoint before its own handler ever ran.
  routeUpgrade(server, VOICE_PATH, (req: IncomingMessage, socket, head) => {
    if (!originAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    void handleConnection(ws, opener);
  });

  return wss;
}

async function handleConnection(ws: WebSocket, opener: LiveOpener): Promise<void> {
  let raw: unknown;
  try {
    raw = await firstMessage(ws, AUTH_TIMEOUT_MS);
  } catch (err) {
    const reason = (err as Error).message === "auth-timeout" ? "auth_timeout" : "closed";
    send(ws, {
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
    });
    ws.close(4001, reason);
    return;
  }

  if (!isAuthMessage(raw)) {
    send(ws, {
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });
    ws.close(4001, "bad_auth");
    return;
  }

  const uid = await uidFromToken(raw.auth.token || undefined);
  if (!uid) {
    send(ws, {
      error: { code: "unauthenticated", message: "Sign in to continue." },
    });
    ws.close(4001, "unauthenticated");
    return;
  }

  const usage = await readUsage(uid);
  const voice = usage.meters.find((meter) => meter.meter === "voice_minutes");
  if (voice && voice.limit !== null && voice.remaining === 0) {
    const message =
      usage.tier === "free"
        ? "You've used this month's voice minutes. Upgrade to Plus for 600 minutes, or keep typing."
        : "You've used this month's voice minutes. You can keep typing.";
    send(ws, { error: { code: "plan_limit", message } });
    ws.close(4008, "plan_limit");
    return;
  }

  const sessionId = raw.auth.sessionId.slice(0, 128);
  const cancelled = new Set<string>();
  const slot: {
    live?: {
      sendPcm: (b: string) => void;
      sendToolResult: (id: string, name: string, payload: unknown) => void;
      close: () => void;
    };
  } = {};

  // Parent document first, so a conversation that only lives in a transcript
  // subcollection is not invisible to listSessions. Title is a placeholder
  // until the first finished user line arrives.
  try {
    await ensureSession(uid, sessionId, { title: VOICE_TITLE });
  } catch (err) {
    console.error("[voice] persist session", sessionId, err);
  }

  let titled = false;

  try {
    slot.live = await opener({
      resumeHandle: raw.auth.resumeHandle,
      events: {
        onReady() {
          send(ws, {
            ready: {
              model: env.liveModel,
              inputHz: INPUT_HZ,
              outputHz: OUTPUT_HZ,
              ...(env.production ? {} : { fake: true as const }),
            },
          });
        },
        onPcm(pcm) {
          send(ws, { pcm });
        },
        onInterrupted() {
          send(ws, { interrupted: true });
        },
        onUserTranscript(text, finished) {
          send(ws, { transcript: { side: "user", text, finished } });
          // Only the finished line. The Live API refines a transcript as it
          // goes — "I'll send", "I'll send the", "I'll send the contract" — and
          // keeping every revision would store one sentence three times, twice
          // of them wrong.
          //
          // Never awaited: a slow write must not delay the caption a person is
          // reading while they speak.
          if (finished) {
            void keep(uid, sessionId, "user", text);
            if (!titled && text.trim()) {
              titled = true;
              void touchSession(uid, sessionId, { utterance: text }).catch((err) =>
                console.error("[voice] retitle session", sessionId, err),
              );
            }
          }
        },
        onModelTranscript(text, finished) {
          send(ws, { transcript: { side: "model", text, finished } });
          if (finished) void keep(uid, sessionId, "model", text);
        },
        onToolCall(call) {
          if (cancelled.has(call.id) || !slot.live) return;
          void runPlanTurn({
            ws,
            live: slot.live,
            uid,
            sessionId,
            call,
            cancelled,
          });
        },
        onToolCancel(ids) {
          for (const id of ids) cancelled.add(id);
        },
        onError(message) {
          send(ws, { error: { code: "voice_unavailable", message } });
        },
        onClose(reason) {
          send(ws, { closing: { reason } });
          if (ws.readyState === WebSocket.OPEN) ws.close();
        },
      },
    });
  } catch (err) {
    console.warn(`[voice] live session refused: ${(err as Error).message}`);
    send(ws, {
      error: {
        code: "voice_unavailable",
        message: "Voice is not available right now. You can keep typing.",
      },
    });
    ws.close(1013, "voice_unavailable");
    return;
  }

  ws.on("message", (data) => {
    const msg = parseJson(data);
    if (isPcmMessage(msg)) {
      slot.live?.sendPcm(msg.pcm);
      return;
    }
    if (msg && typeof msg === "object" && "hangup" in msg) {
      slot.live?.close();
      ws.close();
    }
  });

  // Voice minutes are metered here because here is the only place that knows.
  //
  // The relay holds the socket, so the gateway is the only process that can
  // observe how long a session actually lasted. Asking the browser would mean
  // trusting a client to report its own consumption.
  //
  // Measured from the point the session became usable, not from connect: a
  // user should not be billed for the time we spent opening a Vertex session,
  // or for one that never opened at all.
  const startedAt = Date.now();

  ws.on("close", () => {
    slot.live?.close();

    const seconds = (Date.now() - startedAt) / 1000;
    // Rounded up, and only once a session has lasted long enough to be worth
    // counting. Charging a whole minute for a two-second misfire is the kind
    // of billing detail people notice and resent.
    if (seconds >= 5) {
      void recordUsage(uid, "voice_minutes", Math.ceil(seconds / 60));
    }
  });
}

async function runPlanTurn(opts: {
  ws: WebSocket;
  live: { sendToolResult: (id: string, name: string, payload: unknown) => void };
  uid: string;
  sessionId: string;
  call: { id: string; name: string; args: Record<string, unknown> };
  cancelled: Set<string>;
}): Promise<void> {
  const { ws, live, uid, sessionId, call, cancelled } = opts;
  if (call.name !== "plan_turn") {
    live.sendToolResult(call.id, call.name, { error: "unknown tool" });
    return;
  }

  const request = typeof call.args.request === "string" ? call.args.request.trim() : "";
  if (!request) {
    live.sendToolResult(call.id, call.name, { error: "empty request" });
    return;
  }

  try {
    const prefs = await listPreferences(uid);
    const result = await runTurn({
      sessionId,
      userId: uid,
      message: request,
      knownPreferences: prefs.map((p) => p.now),
    });
    if (cancelled.has(call.id)) return;
    const companionNote =
      result.note || result.confirm?.summary || result.clarify?.question || undefined;
    void touchSession(uid, sessionId, {
      utterance: request,
      plan: result.plan.length > 0 ? result.plan : undefined,
      companionNote,
    }).catch((err) => console.error("[voice] persist turn", sessionId, err));
    send(ws, { turn: result });
    live.sendToolResult(call.id, call.name, result);
  } catch (err) {
    if (cancelled.has(call.id)) return;
    const message = "The planner could not finish this turn.";
    send(ws, { error: { code: "internal", message } });
    live.sendToolResult(call.id, call.name, { error: (err as Error).message });
  }
}
