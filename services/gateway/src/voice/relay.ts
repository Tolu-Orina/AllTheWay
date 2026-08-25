import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { uidFromToken } from "../auth.js";
import { env } from "../env.js";
import { runTurn } from "../orchestrator.js";
import { listPreferences } from "../repos/preferences.js";
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

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== VOICE_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

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

  const sessionId = raw.auth.sessionId.slice(0, 128);
  const cancelled = new Set<string>();
  const slot: {
    live?: {
      sendPcm: (b: string) => void;
      sendToolResult: (id: string, name: string, payload: unknown) => void;
      close: () => void;
    };
  } = {};

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
        },
        onModelTranscript(text, finished) {
          send(ws, { transcript: { side: "model", text, finished } });
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

  ws.on("close", () => {
    slot.live?.close();
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
    send(ws, { turn: result });
    live.sendToolResult(call.id, call.name, result);
  } catch (err) {
    if (cancelled.has(call.id)) return;
    const message = "The planner could not finish this turn.";
    send(ws, { error: { code: "internal", message } });
    live.sendToolResult(call.id, call.name, { error: (err as Error).message });
  }
}
