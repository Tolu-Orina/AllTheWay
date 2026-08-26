import { GoogleAuth } from "google-auth-library";
import WebSocket from "ws";

import { env } from "../env.js";
import {
  DEFAULT_LIVE_MODEL,
  liveModelResource,
  liveWebSocketUrl,
  parseServerMessage,
  realtimePcm,
  setupMessage,
  toolResponse,
  type ParsedServer,
} from "./protocol.js";

export type LiveEvents = {
  onReady: () => void;
  onPcm: (base64: string) => void;
  onInterrupted: () => void;
  onUserTranscript: (text: string, finished: boolean) => void;
  onModelTranscript: (text: string, finished: boolean) => void;
  onToolCall: (call: { id: string; name: string; args: Record<string, unknown> }) => void;
  onToolCancel: (ids: string[]) => void;
  onError: (message: string) => void;
  onClose: (reason: string) => void;
};

export type LiveSession = {
  sendPcm(base64: string): void;
  sendToolResult(id: string, name: string, payload: unknown): void;
  close(): void;
  handle(): string | undefined;
};

export type LiveOpener = (opts: { resumeHandle?: string; events: LiveEvents }) => Promise<LiveSession>;

const OPEN_TIMEOUT_MS = 8_000;
const RECONNECT_PAUSE_MS = 250;
const RECONNECT_MAX_ATTEMPTS = 5;
const PCM_BUFFER_BYTES = 16_000 * 2 * 2; // 2s of 16 kHz s16le

function tonePcmBase64(hz = 440, ms = 280): string {
  const samples = Math.floor((24_000 * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 400, (samples - i) / 400);
    const sample = Math.round(Math.sin((2 * Math.PI * hz * i) / 24_000) * 8000 * envelope);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf.toString("base64");
}

/**
 * Local voice with no Vertex: enough audio and a spoken line that the
 * AudioWorklet path is real, and obviously not a model.
 */
export function openFakeLive(opts: { events: LiveEvents }): Promise<LiveSession> {
  const { events } = opts;
  let closed = false;
  let heard = 0;
  let replied = false;

  queueMicrotask(() => {
    if (!closed) events.onReady();
  });

  return Promise.resolve({
    sendPcm(base64: string) {
      if (closed || replied) return;
      heard += Buffer.from(base64, "base64").byteLength;
      // ~200ms of 16 kHz s16le. After that, one canned reply.
      if (heard < 16_000 * 2 * 0.2) return;
      replied = true;
      events.onUserTranscript("testing voice locally", true);
      events.onPcm(tonePcmBase64());
      events.onModelTranscript(
        "This is a local voice session. The model is not connected, and nothing will be sent or changed.",
        true,
      );
    },
    sendToolResult() {
      /* fake never issues tool calls */
    },
    close() {
      if (closed) return;
      closed = true;
      events.onClose("hangup");
    },
    handle: () => undefined,
  });
}

export function createLiveOpener(): LiveOpener {
  if (!env.production) {
    return ({ events }) => openFakeLive({ events });
  }
  return (opts) => openVertexLive(opts);
}

async function accessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const got = await client.getAccessToken();
  const token = typeof got === "string" ? got : got?.token;
  if (!token) throw new Error("no Vertex access token");
  return token;
}

function openSocket(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Vertex Live socket timed out"));
    }, OPEN_TIMEOUT_MS);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function openVertexLive(opts: {
  resumeHandle?: string;
  events: LiveEvents;
}): Promise<LiveSession> {
  const events = opts.events;
  const model = env.liveModel || DEFAULT_LIVE_MODEL;
  // env.liveLocation, not env.vertexLocation — the Live model does not exist
  // at `global`, which is where text generation runs. See env.ts.
  const modelResource = liveModelResource(env.projectId, env.liveLocation, model);
  const url = liveWebSocketUrl(env.liveLocation);

  let handle = opts.resumeHandle;
  let closed = false;
  let ready = false;
  let socket: WebSocket | undefined;
  const pending: string[] = [];
  let pendingBytes = 0;
  let reconnecting = false;
  // A session that opens and is immediately closed by Vertex would otherwise
  // reconnect forever, a quarter second apart, for as long as the browser
  // holds the socket. Reset once a reconnect actually produces a live session.
  let attempts = 0;

  const flushPending = (ws: WebSocket) => {
    for (const chunk of pending) ws.send(JSON.stringify(realtimePcm(chunk)));
    pending.length = 0;
    pendingBytes = 0;
  };

  const bufferPcm = (base64: string) => {
    pending.push(base64);
    pendingBytes += Buffer.from(base64, "base64").byteLength;
    while (pendingBytes > PCM_BUFFER_BYTES && pending.length > 1) {
      const dropped = pending.shift();
      if (dropped) pendingBytes -= Buffer.from(dropped, "base64").byteLength;
    }
  };

  const attach = (ws: WebSocket) => {
    socket = ws;
    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      const msg: ParsedServer = parseServerMessage(parsed);
      if (msg.setupComplete) {
        attempts = 0;
        if (!ready) {
          ready = true;
          events.onReady();
        }
        flushPending(ws);
      }
      if (msg.interrupted) events.onInterrupted();
      for (const pcm of msg.pcm ?? []) events.onPcm(pcm);
      if (msg.userTranscript) {
        events.onUserTranscript(msg.userTranscript.text, msg.userTranscript.finished);
      }
      if (msg.modelTranscript) {
        events.onModelTranscript(msg.modelTranscript.text, msg.modelTranscript.finished);
      }
      for (const call of msg.toolCalls ?? []) events.onToolCall(call);
      if (msg.toolCallCancellations?.length) events.onToolCancel(msg.toolCallCancellations);
      if (msg.resumeHandle) handle = msg.resumeHandle;
      if (msg.goAway) void reconnect("goAway");
    });
    ws.on("close", () => {
      if (!closed && !reconnecting) void reconnect("vertex-close");
    });
    ws.on("error", (err) => {
      if (!closed) events.onError(err.message);
    });
  };

  const connect = async (resume?: string) => {
    const token = await accessToken();
    const ws = await openSocket(url, token);
    ws.send(JSON.stringify(setupMessage({ modelResource, resumeHandle: resume })));
    attach(ws);
  };

  const reconnect = async (reason: string) => {
    if (closed || reconnecting) return;
    reconnecting = true;
    const previous = socket;
    socket = undefined;
    try {
      previous?.close();
    } catch {
      /* already gone */
    }
    attempts += 1;
    if (attempts > RECONNECT_MAX_ATTEMPTS) {
      reconnecting = false;
      events.onError("Voice keeps dropping. You can keep typing.");
      events.onClose("resume_failed");
      return;
    }

    // Backs off rather than retrying at a fixed interval: whatever made Vertex
    // hang up is unlikely to be fixed 250ms later, and a tight loop turns one
    // failing session into sustained load.
    await new Promise((r) =>
      setTimeout(r, RECONNECT_PAUSE_MS * 2 ** (attempts - 1)),
    );
    if (closed) return;
    try {
      await connect(handle);
      reconnecting = false;
    } catch (err) {
      reconnecting = false;
      events.onError(
        `Voice session could not resume after ${reason}: ${(err as Error).message}`,
      );
      events.onClose("resume_failed");
    }
  };

  await connect(handle);

  return {
    sendPcm(base64: string) {
      if (closed) return;
      if (!socket || socket.readyState !== WebSocket.OPEN || !ready) {
        bufferPcm(base64);
        return;
      }
      socket.send(JSON.stringify(realtimePcm(base64)));
    },
    sendToolResult(id: string, name: string, payload: unknown) {
      if (closed || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(toolResponse(id, name, payload)));
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      events.onClose("hangup");
    },
    handle: () => handle,
  };
}
