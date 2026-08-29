import "./test-env.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import WebSocket from "ws";

import { env } from "./env.js";
import { attachVoice } from "./voice/relay.js";
import { openFakeLive, type LiveEvents } from "./voice/backend.js";
import {
  isAuthMessage,
  liveWebSocketUrl,
  parseServerMessage,
  realtimePcm,
  setupMessage,
  SYSTEM_INSTRUCTION,
  foldTranscript,
  TranscriptAccumulator,
} from "./voice/protocol.js";
import { READ_TOOL_NAMES, SESSION_TOOL_NAMES, runReadTool } from "./voice/tools.js";
import { END_THIS_CONVERSATION, setHangupDelaysForTests } from "./voice/hangup.js";

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
  assert.match(json, /end_this_conversation/);
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

test("finished with no new text is still a commit", () => {
  const parsed = parseServerMessage({
    serverContent: { inputTranscription: { finished: true } },
  });
  assert.deepEqual(parsed.userTranscript, { text: "", finished: true });
});

test("turnComplete is parsed so an utterance without finished can still commit", () => {
  const parsed = parseServerMessage({
    serverContent: { turnComplete: true, outputTranscription: { text: "ok" } },
  });
  assert.equal(parsed.turnComplete, true);
  assert.deepEqual(parsed.modelTranscript, { text: "ok", finished: false });
});

test("transcript chunks fold as either deltas or refinements", () => {
  assert.equal(foldTranscript("I'll", "I'll send"), "I'll send");
  assert.equal(foldTranscript("I'll send", " the contract"), "I'll send the contract");
  assert.equal(foldTranscript("Hello wor", "ld"), "Hello world");

  const acc = new TranscriptAccumulator();
  assert.equal(acc.push("user", "I'll", false).text, "I'll");
  assert.equal(acc.push("user", " send", false).text, "I'll send");
  const done = acc.push("user", "", true);
  assert.equal(done.text, "I'll send");
  assert.equal(done.finished, true);
  assert.deepEqual(acc.flush(), []);
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


/**
 * The language rules, asserted because they are invisible.
 *
 * A system instruction has no type and no runtime error: a line deleted during
 * an unrelated edit changes how the product behaves for everyone who does not
 * speak English, and nothing fails. These assertions are deliberately about
 * *properties* rather than wording, so the prose can be improved without
 * breaking them.
 */
test("the voice instruction tells the model to follow the speaker's language", () => {
  const s = SYSTEM_INSTRUCTION.toLowerCase();
  assert.match(s, /speak the language they speak/);
  assert.match(s, /switch the moment they switch/);
  // Silently: announcing a switch turns the user's own language into a topic.
  assert.match(s, /never announce a switch/);
  assert.match(s, /never ask them to choose one/);
});

test("the voice instruction expects code-mixing rather than correcting it", () => {
  // Mixing English with Yoruba or Pidgin inside one sentence is fluent speech
  // for a great many users. A companion that tidies it is correcting them.
  const s = SYSTEM_INSTRUCTION.toLowerCase();
  assert.match(s, /mix languages inside one sentence/);
  assert.match(s, /mirror the mix/);
  assert.match(s, /do not tidy them into a/);
  // ...but a single loanword must not flip the whole reply.
  assert.match(s, /one borrowed word is not a switch/);
});

test("the voice instruction does not let an English plan be read out in English", () => {
  // plan_turn returns the orchestrator's result, which is generated in English.
  // Without this rule a French speaker hears the confirmation in English --
  // exactly at the moment they are being asked to approve something.
  const s = SYSTEM_INSTRUCTION.toLowerCase();
  assert.match(s, /plan_turn answers you in english/);
  assert.match(s, /do not read that english aloud/);
  // The request goes up in the user's own words, untranslated.
  assert.match(s, /in the language they used/);
  assert.match(s, /do not translate the request first/);
});

test("the voice instruction still refuses to claim work it has not done", () => {
  assert.match(SYSTEM_INSTRUCTION, /Never claim you have sent, paid, or deleted anything\./);
  // Honesty about languages it cannot speak, rather than bad output in them.
  assert.match(SYSTEM_INSTRUCTION, /Igbo/);
});

test("the voice instruction hangs up only when they are leaving the conversation", () => {
  const s = SYSTEM_INSTRUCTION.toLowerCase();
  assert.match(s, /end_this_conversation/);
  assert.match(s, /ending this conversation/);
  assert.match(s, /that is plan_turn/);
  assert.match(s, /leaving is not a yes/);
});


test("voice keeps automatic turn detection, but not at its most eager", () => {
  /**
   * The model answers whatever the microphone hears and cannot tell speakers
   * apart, so a user turning to talk to someone else in the room got an answer
   * meant for them.
   *
   * Automatic detection stays on — push-to-talk would tax every ordinary turn
   * to fix an occasional problem — but it is deliberately less eager, and the
   * browser has a mute control for when the room is not its business.
   */
  const msg = setupMessage({
    modelResource: "projects/p/locations/global/publishers/google/models/gemini-live-2.5-flash-native-audio",
  });
  const setup = msg.setup as Record<string, unknown>;
  const rt = setup.realtimeInputConfig as { automaticActivityDetection?: Record<string, unknown> };
  const vad = rt?.automaticActivityDetection;

  assert.ok(vad, "voice must configure activity detection explicitly");
  // Not the transcriber's setting: disabling detection here would mean the
  // model never decides a turn ended, and it would never reply at all.
  assert.notEqual(vad.disabled, true);
  assert.equal(vad.startOfSpeechSensitivity, "START_SENSITIVITY_LOW");
  assert.ok(
    (vad.silenceDurationMs as number) >= 700,
    "too short a silence window makes it interrupt a pause mid-thought",
  );
  assert.ok(
    (vad.prefixPaddingMs as number) > 0,
    "without prefix padding the first syllable of a turn is clipped",
  );
});

test("voice can look things up, and every lookup is read-only", () => {
  /**
   * The gap this closes: the model had exactly one tool, `plan_turn`, and the
   * planner it reaches is told "never take an action; only plan". Asked about a
   * meeting later that day, there was nothing it could consult — so it answered
   * from the conversation alone and did not know.
   */
  const msg = setupMessage({
    modelResource: "projects/p/locations/global/publishers/google/models/gemini-live-2.5-flash-native-audio",
  });
  const decls = (msg.setup as { tools: { functionDeclarations: { name: string }[] }[] })
    .tools[0].functionDeclarations;
  const names = decls.map((d) => d.name);

  assert.ok(names.includes("whats_on_my_calendar"), "voice must be able to see the day");
  assert.ok(names.includes("ask_my_documents"));
  assert.ok(names.includes("whats_waiting_for_me"));
  assert.ok(names.includes("my_recent_meetings"));
  assert.ok(names.includes("plan_turn"), "the planner must remain");
  assert.ok(names.includes(END_THIS_CONVERSATION), "voice must be able to leave");
  assert.ok(
    names.indexOf(END_THIS_CONVERSATION) > names.indexOf("plan_turn"),
    "hanging up must not be preferred over looking up or planning",
  );

  // The safety property, stated as a test: nothing that changes the world is
  // reachable directly. Writes go through plan_turn and stop at the confirm
  // gate, so a misheard sentence cannot send, pay, or delete anything.
  // Leaving the conversation is the other exception: it closes the socket.
  for (const name of names) {
    if (name === "plan_turn" || SESSION_TOOL_NAMES.has(name)) continue;
    assert.ok(
      READ_TOOL_NAMES.has(name),
      `${name} is declared to voice but is not a read tool — writes must go through plan_turn`,
    );
  }
  assert.equal(SESSION_TOOL_NAMES.has(END_THIS_CONVERSATION), true);
  assert.equal(READ_TOOL_NAMES.has(END_THIS_CONVERSATION), false);
});

test("a read tool answers rather than throwing, even when it cannot help", async () => {
  // A rejected tool call leaves the model holding nothing at the moment it is
  // about to speak, and nothing is what a confident invention looks like from
  // the inside. Every path returns an object.
  const result = await runReadTool("nobody", "no_such_tool", {});
  assert.equal(typeof result, "object");
  assert.ok("cannot" in result, "an unknown tool must explain itself, not throw");
});

async function connectVoice(
  port: number,
): Promise<{ ws: WebSocket; inbox: unknown[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/live`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const inbox: unknown[] = [];
  ws.on("message", (data) => inbox.push(JSON.parse(String(data))));
  ws.send(JSON.stringify({ auth: { token: "", sessionId: "s-hangup" } }));
  await waitFor(() => inbox.some((m) => m && typeof m === "object" && "ready" in m));
  return { ws, inbox };
}

test("end_this_conversation closes the browser socket after farewell, not as a plan", async () => {
  const restore = setHangupDelaysForTests({ silentMs: 40, playoutMs: 40, watchdogMs: 400 });
  try {

  let events: LiveEvents | undefined;
  const toolResults: { name: string; payload: unknown }[] = [];
  const server = createServer();
  attachVoice(server, ({ events: ev }) => {
    events = ev;
    queueMicrotask(() => ev.onReady());
    return Promise.resolve({
      sendPcm() {},
      sendToolResult(_id, name, payload) {
        toolResults.push({ name, payload });
      },
      close() {
        ev.onClose("hangup");
      },
      handle: () => undefined,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  after(() => server.close());
  const { port } = server.address() as { port: number };

  const { ws, inbox } = await connectVoice(port);
  const closed = new Promise<{ code: number }>((resolve) => {
    ws.once("close", (code) => resolve({ code }));
  });

  events?.onToolCall({ id: "h1", name: END_THIS_CONVERSATION, args: {} });
  assert.equal(toolResults[0]?.name, END_THIS_CONVERSATION);
  assert.equal((toolResults[0]?.payload as { will_hangup?: boolean }).will_hangup, true);
  assert.equal(
    inbox.some((m) => m && typeof m === "object" && "turn" in m),
    false,
    "leaving must not surface as a confirmable turn",
  );

  events?.onPcm("QQ==");
  events?.onTurnComplete?.();

  await waitFor(() => inbox.some((m) => (m as { closing?: { reason?: string } }).closing?.reason === "hangup"));
  const { code } = await closed;
  assert.equal(code, 4000);
  } finally {
    restore();
  }
});

test("barge-in after end_this_conversation keeps the session live", async () => {
  const restore = setHangupDelaysForTests({ silentMs: 40, playoutMs: 40, watchdogMs: 180 });
  try {

  let events: LiveEvents | undefined;
  const server = createServer();
  attachVoice(server, ({ events: ev }) => {
    events = ev;
    queueMicrotask(() => ev.onReady());
    return Promise.resolve({
      sendPcm() {},
      sendToolResult() {},
      close() {
        ev.onClose("hangup");
      },
      handle: () => undefined,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  after(() => server.close());
  const { port } = server.address() as { port: number };

  const { ws, inbox } = await connectVoice(port);
  events?.onToolCall({ id: "h2", name: END_THIS_CONVERSATION, args: {} });
  events?.onInterrupted();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    inbox.some((m) => (m as { closing?: unknown }).closing),
    false,
    "interrupt must cancel spoken hang-up",
  );
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  } finally {
    restore();
  }
});

test("toolCallCancellation of end_this_conversation cancels hang-up", async () => {
  const restore = setHangupDelaysForTests({ silentMs: 40, playoutMs: 40, watchdogMs: 180 });
  try {
  let events: LiveEvents | undefined;
  const server = createServer();
  attachVoice(server, ({ events: ev }) => {
    events = ev;
    queueMicrotask(() => ev.onReady());
    return Promise.resolve({
      sendPcm() {},
      sendToolResult() {},
      close() {
        ev.onClose("hangup");
      },
      handle: () => undefined,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  after(() => server.close());
  const { port } = server.address() as { port: number };

  const { ws, inbox } = await connectVoice(port);
  events?.onToolCall({ id: "h3", name: END_THIS_CONVERSATION, args: {} });
  events?.onToolCancel(["h3"]);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(inbox.some((m) => (m as { closing?: unknown }).closing), false);
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  } finally {
    restore();
  }
});

