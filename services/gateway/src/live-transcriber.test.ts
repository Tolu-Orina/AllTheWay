import "./test-env.js";
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { takeTranscript } from "./meetings/live-transcriber.js";
import { parseServerMessage } from "./voice/protocol.js";

test("interims fold; only a finished or completed turn is committed", () => {
  const first = takeTranscript("", { text: "I'll", finished: false }, false);
  equal(first.committed, undefined);
  equal(first.held, "I'll");

  const refined = takeTranscript(first.held, { text: "I'll send", finished: false }, false);
  equal(refined.committed, undefined);
  equal(refined.held, "I'll send");

  const done = takeTranscript(refined.held, { text: "I'll send the contract", finished: true }, false);
  equal(done.committed, "I'll send the contract");
  equal(done.held, "");
});

test("turnComplete commits a held utterance that never got finished: true", () => {
  const held = takeTranscript("", { text: "hello there", finished: false }, false);
  const done = takeTranscript(held.held, undefined, true);
  equal(done.committed, "hello there");
  equal(done.held, "");
});

test("an empty finished with nothing held is not a note", () => {
  const empty = takeTranscript("", { text: "", finished: true }, false);
  equal(empty.committed, undefined);
  equal(empty.held, "");
});

test("interimInputTranscription is unfinished even if the server marks finished", () => {
  const parsed = parseServerMessage({
    serverContent: {
      interimInputTranscription: { text: "hello wor", finished: true },
    },
  });
  deepEqual(parsed.userTranscript, { text: "hello wor", finished: false });
});
