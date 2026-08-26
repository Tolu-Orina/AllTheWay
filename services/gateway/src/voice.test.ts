import "./test-env.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import WebSocket from "ws";

import { env } from "./env.js";
import { attachVoice } from "./voice/relay.js";
import { openFakeLive } from "./voice/backend.js";
import {
  isAuthMessage,
  liveWebSocketUrl,
  parseServerMessage,
  realtimePcm,
  setupMessage,
} from "./voice/protocol.js";

test("auth message requires a session id", () => {
  assert.equal(isAuthMessage({ auth: { token: "x", sessionId: "s1" } }), true);
  assert.equal(isAuthMessage({ auth: { token: "x", sessionId: "" } }), false);
  assert.equal(isAuthMessage({ pcm: "aa" }), false);
});

test("the Live session is never opened at `global`", () => {
  // `global` has no Live model. The setup message is refused with
  // "Publisher model .../locations/global/... was not found", so voice fails
  // on every attempt — and nothing else catches it, because the URL builder is
  // perfectly correct for `global` and the model name is perfectly valid.
  //
  // This asserts the two are not allowed to be the same setting again.
  assert.notEqual(env.liveLocation, "global");
  assert.match(env.liveLocation, /^[a-z]+-[a-z]+\d$/);
});

test("global Live endpoint is not location-prefixed", () => {
  assert.equal(
    liveWebSocketUrl("global"),
    "wss://aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent",
  );
  assert.match(liveWebSocketUrl("europe-west1"), /^wss:\/\/europe-west1-aiplatform/);
});

test("setup enables resumption, transcriptions, and plan_turn — not a language code", () => {
  const msg = setupMessage({
    modelResource: "projects/p/locations/global/publishers/google/models/gemini-live-2.5-flash-native-audio",
  });
  const setup = (msg.setup as Record<string, unknown>);
  const json = JSON.stringify(setup);
  assert.equal("languageCode" in setup || "language_code" in setup, false);
  assert.ok(setup.sessionResumption);
  assert.ok(setup.inputAudioTranscription);
  assert.match(json, /plan_turn/);
  assert.match(json, /AUDIO/);
});

test("realtime PCM is 16 kHz wrapped for Vertex, not raw bytes on our socket", () => {
  const wrapped = realtimePcm("YWI=");
  const chunk = (wrapped.realtimeInput as { mediaChunks: { mimeType: string; data: string }[] })
    .mediaChunks[0];
  assert.equal(chunk.mimeType, "audio/pcm;rate=16000");
  assert.equal(chunk.data, "YWI=");
});

test("server messages parse both camelCase and snake_case", () => {
  const camel = parseServerMessage({
    setupComplete: {},
    serverContent: {
      interrupted: true,
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "QQ==" } }] },
      inputTranscription: { text: "hello", finished: true },
    },
    sessionResumptionUpdate: { newHandle: "h1", resumable: true },
    goAway: { timeLeft: "10s" },
  });
  assert.equal(camel.setupComplete, true);
  assert.equal(camel.interrupted, true);
  assert.deepEqual(camel.pcm, ["QQ=="]);
  assert.deepEqual(camel.userTranscript, { text: "hello", finished: true });
  assert.equal(camel.resumeHandle, "h1");
  assert.equal(camel.goAway, true);

  const snake = parseServerMessage({
    setup_complete: {},
    server_content: {
      model_turn: { parts: [{ inline_data: { mime_type: "audio/pcm", data: "Qg==" } }] },
      output_transcription: { text: "hi", finished: false },
    },
    session_resumption_update: { new_handle: "h2", resumable: true },
    tool_call: { function_calls: [{ id: "1", name: "plan_turn", args: { request: "x" } }] },
  });
  assert.deepEqual(snake.pcm, ["Qg=="]);
  assert.deepEqual(snake.modelTranscript, { text: "hi", finished: false });
  assert.equal(snake.resumeHandle, "h2");
  assert.equal(snake.toolCalls?.[0]?.name, "plan_turn");
});

test("a resumable=false update is not a handle to reconnect with", () => {
  const parsed = parseServerMessage({
    sessionResumptionUpdate: { newHandle: "stale", resumable: false },
  });
  assert.equal(parsed.resumeHandle, undefined);
});

test("relay authenticates on the first message and fakes a spoken reply", async () => {
  const server = createServer();
  attachVoice(server, ({ events }) => openFakeLive({ events }));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  after(() => server.close());

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/live`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const inbox: unknown[] = [];
  ws.on("message", (data) => inbox.push(JSON.parse(String(data))));

  ws.send(JSON.stringify({ auth: { token: "", sessionId: "s-test" } }));

  await waitFor(() => inbox.some((m) => m && typeof m === "object" && "ready" in m));
  const ready = inbox.find((m) => m && typeof m === "object" && "ready" in m) as {
    ready: { inputHz: number; outputHz: number; fake?: true };
  };
  assert.equal(ready.ready.inputHz, 16000);
  assert.equal(ready.ready.outputHz, 24000);
  assert.equal(ready.ready.fake, true);

  ws.send(JSON.stringify({ pcm: Buffer.alloc(16_000 * 2 * 0.25).toString("base64") }));

  await waitFor(() => inbox.some((m) => m && typeof m === "object" && "pcm" in m));
  assert.ok(inbox.some((m) => (m as { transcript?: { side: string } }).transcript?.side === "model"));

  ws.close();
});

test("a socket that never authenticates is closed", async () => {
  const server = createServer();
  attachVoice(server, ({ events }) => openFakeLive({ events }));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  after(() => server.close());
  const { port } = server.address() as { port: number };

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/live`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const closed = await new Promise<number>((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
  assert.equal(closed, 4001);
});

function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("timed out"));
      setTimeout(tick, 15);
    };
    tick();
  });
}
