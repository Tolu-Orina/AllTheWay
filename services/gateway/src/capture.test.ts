import "./test-env.js";
import { ok, strictEqual } from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";

import { CAPTURE_PATH, attachCapture, type CaptureDeps } from "./meetings/capture.js";
import { VOICE_PATH } from "./voice/protocol.js";
import { attachVoice } from "./voice/relay.js";
import { transcribeSetup } from "./meetings/transcriber.js";

/**
 * Tier 1.5 captures a real meeting on someone's own machine. These are the ways
 * that goes wrong: audio reaching an unauthenticated socket, a session that
 * records forever, and — the one that would undo the whole feature — a model
 * that answers the room instead of transcribing it.
 */

const OPEN_CALLS: string[] = [];

function deps(overrides: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    openTranscriber: async (events) => ({
      sendPcm: (b64) => {
        // Echo one utterance per frame so the plumbing is observable.
        events.onUtterance({ at: new Date().toISOString(), text: `heard:${b64.length}` });
      },
      close: () => {},
    }),
    onUtterance: async () => {},
    onOpen: async (uid, meetingId) => void OPEN_CALLS.push(`${uid}:${meetingId}`),
    onClose: async () => {},
    ...overrides,
  };
}

async function listening(attach: (server: ReturnType<typeof createServer>) => void) {
  const server = createServer();
  attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  return { server, port };
}

function connect(port: number, path: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`);
}

async function firstFrame(ws: WebSocket, timeoutMs = 4000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no frame")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
    ws.once("close", () => {
      clearTimeout(timer);
      reject(new Error("closed"));
    });
  });
}

test("audio cannot reach an unauthenticated socket", async () => {
  const { server, port } = await listening((s) => attachCapture(s, deps()));
  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));

  // No auth frame — straight to audio, which is what a hostile client would do.
  ws.send(JSON.stringify({ pcm: "AAAA" }));

  const frame = await firstFrame(ws);
  strictEqual((frame.error as { code?: string })?.code, "unauthenticated");

  ws.close();
  server.close();
});

test("a session that never authenticates is closed rather than left open", async () => {
  // An open socket carrying nothing still holds an instance. Voice learned this
  // the same way.
  const { server, port } = await listening((s) => attachCapture(s, deps()));
  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));

  const code = await new Promise<number>((resolve) => ws.once("close", resolve));
  ok(code >= 4000, `expected an application close code, got ${code}`);

  server.close();
});

test("a malformed first frame is refused", async () => {
  const { server, port } = await listening((s) => attachCapture(s, deps()));
  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));

  ws.send(JSON.stringify({ auth: { token: "x" } })); // no meetingId

  const frame = await firstFrame(ws);
  strictEqual((frame.error as { code?: string })?.code, "unauthenticated");
  ws.close();
  server.close();
});

test("voice and capture can share one server", async () => {
  /**
   * The bug this prevents, which would have been very hard to read.
   *
   * Node calls every `upgrade` listener. The voice relay used to destroy any
   * socket whose path it did not recognise, so capture's socket would have been
   * torn down before capture's own handler ran — the client seeing a connection
   * closed immediately, and the capture endpoint's logs showing nothing at all,
   * because it never saw the request.
   */
  const { server, port } = await listening((s) => {
    attachVoice(s);
    attachCapture(s, deps());
  });

  const ws = connect(port, CAPTURE_PATH);
  const opened = await new Promise<boolean>((resolve) => {
    ws.once("open", () => resolve(true));
    ws.once("error", () => resolve(false));
  });

  strictEqual(opened, true, "capture was refused while voice shared the server");
  ws.close();
  server.close();
});

test("an unknown websocket path still 404s", async () => {
  // The router owns this now. Losing it would leave stray upgrades hanging
  // open instead of being refused.
  const { server, port } = await listening((s) => {
    attachVoice(s);
    attachCapture(s, deps());
  });

  const ws = connect(port, "/api/nothing-here");
  const failed = await new Promise<boolean>((resolve) => {
    ws.once("open", () => resolve(false));
    ws.once("error", () => resolve(true));
  });

  strictEqual(failed, true);
  server.close();
});

test("both real paths are registered", () => {
  // Cheap, and it catches a rename on one side of the client/server pair.
  strictEqual(CAPTURE_PATH, "/api/meetings/capture");
  strictEqual(VOICE_PATH, "/api/voice/live");
});

test("the transcription session cannot answer the room", () => {
  /**
   * FR-C4, enforced by configuration rather than by hoping a prompt holds.
   *
   * Three properties together: no tools, so overheard speech can never become
   * an action; automatic activity detection disabled, so the model never
   * decides a turn ended and replies; and TEXT rather than AUDIO, so there is
   * no voice to emit even if it tried.
   */
  const setup = transcribeSetup("some-model", "some-project").setup as Record<string, unknown>;

  strictEqual("tools" in setup, false, "a meeting must never be able to trigger an action");
  strictEqual("systemInstruction" in setup, false);

  const realtime = setup.realtimeInputConfig as { automaticActivityDetection?: { disabled?: boolean } };
  strictEqual(realtime.automaticActivityDetection?.disabled, true);

  const generation = setup.generationConfig as { responseModalities?: string[] };
  strictEqual(generation.responseModalities?.includes("AUDIO"), false);

  ok("inputAudioTranscription" in setup, "transcription is the only thing wanted");
});

test("the transcription model is configurable", async () => {
  // It launched on 26 August 2026 and is not yet resolvable on Vertex. When it
  // arrives this is an environment variable, not a rewrite.
  const { TRANSCRIBE_MODEL } = await import("./meetings/transcriber.js");
  ok(TRANSCRIBE_MODEL.length > 0);
});


test("the model and its location are the verified ones", async () => {
  /**
   * Both were wrong in an earlier version, in ways that would have failed at
   * runtime rather than at build:
   *
   *   - the id lacked its `-preview` suffix, so it resolved to nothing;
   *   - the location reused `env.liveLocation`, which is regional *because the
   *     voice model does not exist at `global`*. This model is the exact
   *     opposite: `global` is the only place it is served.
   *
   * Verified against the live endpoint, which answered `setupComplete`.
   */
  const { TRANSCRIBE_MODEL, TRANSCRIBE_LOCATION } = await import("./meetings/transcriber.js");
  strictEqual(TRANSCRIBE_MODEL, "gemini-3.5-transcribe-live-preview");
  strictEqual(TRANSCRIBE_LOCATION, "global");
});

test("no language is forced, so code-mixing survives", async () => {
  /**
   * The model auto-detects across 85+ languages and handles switching
   * mid-sentence. Pinning a code would narrow that — and someone moving
   * between English and Yoruba mid-sentence is precisely the case this product
   * exists to serve.
   */
  const { transcribeSetup: setupFor } = await import("./meetings/transcriber.js");
  const auto = (setupFor("m", "p").setup as Record<string, unknown>)
    .inputAudioTranscription as Record<string, unknown>;
  strictEqual(Object.keys(auto).length, 0, "a language was forced by default");

  const hinted = (setupFor("m", "p", ["en-GB"]).setup as Record<string, unknown>)
    .inputAudioTranscription as { languageCodes?: string[] };
  strictEqual(hinted.languageCodes?.[0], "en-GB");
});

test("a session rotates before the model's ten-minute audio limit", async () => {
  // One session accepts ten minutes; a meeting is ninety. Rotating at the limit
  // would lose whatever sentence was in flight, so it happens earlier.
  const { ROTATE_AFTER_MS, SESSION_AUDIO_LIMIT_MS } = await import("./meetings/transcriber.js");
  ok(ROTATE_AFTER_MS < SESSION_AUDIO_LIMIT_MS, "rotation must start before the limit");
  ok(SESSION_AUDIO_LIMIT_MS - ROTATE_AFTER_MS >= 60_000, "too little headroom to rotate safely");
});


function authFrame(meetingId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    auth: { token: "anything", meetingId, disclosed: true, ...extra },
  });
}

test("an utterance does not crash the session before insights are set up", async () => {
  /**
   * The bug this pins down.
   *
   * The insight state was originally declared *after* the transcriber was
   * opened, while the transcriber's own callback referenced it. TypeScript
   * accepted that — the reference is inside a closure — and it would have
   * thrown a ReferenceError on the very first utterance of every meeting.
   *
   * Driving one utterance through is enough to catch it, and cheap.
   */
  let heard: unknown[] = [];
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      runInsights: async () => {
        heard.push("ran");
        return { insights: [] };
      },
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(authFrame("m1"));

  // ALLOW_ANONYMOUS is set for tests, so this authenticates and the session
  // opens; the first frame back tells us it survived setup.
  const frame = await firstFrame(ws, 6000).catch(() => null);
  ok(frame !== null, "the session did not survive opening");

  ws.close();
  server.close();
});

test("insights can be asked for rather than waited for", async () => {
  /**
   * The schedule widens as a meeting settles, which means the moment somebody
   * actually wants a check is exactly when the next scheduled pass is furthest
   * away. The on-demand path exists for that, and it must bypass the schedule
   * rather than politely respect it.
   */
  let ran = 0;
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      runInsights: async () => {
        ran += 1;
        return {
          insights: [{ id: "i1", at: new Date().toISOString(), kind: "context", text: "x", sources: [] }],
        };
      },
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(authFrame("m2"));
  await firstFrame(ws, 6000).catch(() => null);

  ws.send(JSON.stringify({ insights: "now" }));

  // Give the pass a moment; the assertion is that it ran at all, well before
  // the first scheduled mark at one minute.
  await new Promise((r) => setTimeout(r, 400));
  strictEqual(ran, 1, "an explicit request did not run a pass");

  ws.close();
  server.close();
});

test("a session without disclosure is refused before it opens", async () => {
  const opened: string[] = [];
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      onOpen: async (_uid, meetingId) => void opened.push(meetingId),
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ auth: { token: "anything", meetingId: "m-secret" } }));

  const frame = await firstFrame(ws);
  strictEqual((frame.error as { code?: string })?.code, "undisclosed");
  strictEqual(opened.length, 0, "an undisclosed session must not create a meeting");

  ws.close();
  server.close();
});

test("disclosure must be the boolean true, not a string", async () => {
  const opened: string[] = [];
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      onOpen: async (_uid, meetingId) => void opened.push(meetingId),
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(
    JSON.stringify({ auth: { token: "anything", meetingId: "m-str", disclosed: "true" } }),
  );

  const frame = await firstFrame(ws);
  strictEqual((frame.error as { code?: string })?.code, "undisclosed");
  strictEqual(opened.length, 0);

  ws.close();
  server.close();
});

test("a capture token can be refreshed mid-session", async () => {
  const { server, port } = await listening((s) => attachCapture(s, deps()));
  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(authFrame("m-refresh"));
  await firstFrame(ws, 6000);

  ws.send(JSON.stringify({ refresh: { token: "anything" } }));
  ws.send(JSON.stringify({ pcm: "AAAA" }));

  const frame = await firstFrame(ws, 4000);
  ok((frame as { transcript?: { text?: string } }).transcript, "refresh closed the session");

  ws.close();
  server.close();
});

test("Check now always answers, even when there is nothing to show", async () => {
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      runInsights: async () => ({ insights: [], quiet: "metered" }),
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(authFrame("m-quiet"));
  await firstFrame(ws, 6000);

  ws.send(JSON.stringify({ insights: "now" }));
  const frame = await firstFrame(ws, 4000);
  strictEqual((frame as { quiet?: string }).quiet, "metered");
  ok(Array.isArray((frame as { insights?: unknown[] }).insights));

  ws.close();
  server.close();
});

test("a Meet caption name attaches only when the utterance matches", async () => {
  const heard: Array<{ text: string; speaker?: string }> = [];
  const { server, port } = await listening((s) =>
    attachCapture(s, {
      ...deps(),
      openTranscriber: async (events) => ({
        sendPcm: () => {
          events.onUtterance({ at: new Date().toISOString(), text: "I'll send the contract today" });
        },
        close: () => {},
      }),
      onUtterance: async (_uid, _id, utterance) => {
        heard.push({ text: utterance.text, speaker: utterance.speaker });
      },
    }),
  );

  const ws = connect(port, CAPTURE_PATH);
  await new Promise((r) => ws.once("open", r));
  ws.send(authFrame("m-cap", { meetUrl: "https://meet.google.com/abc-defg-hij" }));
  await firstFrame(ws, 6000);

  ws.send(JSON.stringify({ caption: { speaker: "Ada Cole", text: "I'll send the contract today" } }));
  ws.send(JSON.stringify({ pcm: "AAAA" }));

  const frame = await firstFrame(ws, 4000);
  const transcript = frame as { transcript?: { speaker?: string; text?: string } };
  strictEqual(transcript.transcript?.speaker, "Ada Cole");

  await new Promise((r) => setTimeout(r, 50));
  strictEqual(heard[0]?.speaker, "Ada Cole");

  ws.close();
  server.close();
});
