import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessage } from "./orchestrator.js";
import { correctionFields } from "./repos/sessions.js";
import { assembleTurnContext } from "./turn-context.js";

/**
 * The four stores a turn injects, and the A2A message they become.
 *
 * Voice `plan_turn` and a typed POST both go through `loadTurnContext`. This
 * file proves the mapping and the wire shape without opening Firestore or a
 * Live socket (those hang).
 */

test("a correction without what it should have been is not a learning signal", () => {
  assert.deepEqual(correctionFields("six items", undefined), {
    ok: false,
    reason: "missing_now",
  });
  assert.deepEqual(correctionFields("six items", "   "), {
    ok: false,
    reason: "missing_now",
  });
  assert.deepEqual(correctionFields("six items", "six items"), {
    ok: false,
    reason: "noop",
  });
  assert.deepEqual(correctionFields("  six items  ", "four items"), {
    ok: true,
    was: "six items",
    now: "four items",
  });
});

test("voice and text assemble the same four stores into one turn payload", () => {
  const input = assembleTurnContext({
    uid: "u1",
    sessionId: "s1",
    message: "what's in the contract",
    prefs: [{ now: "four items, collapsed" }],
    passages: [
      {
        chunkId: "c1",
        documentId: "d1",
        title: "Contract.pdf",
        page: 2,
        text: "Termination on 30 days' notice.",
      },
    ],
    lookups: ["Standup at 10."],
    thread: [
      {
        role: "user",
        text: "Draft the nav",
        at: "2026-08-28T00:00:00.000Z",
      },
    ],
  });

  assert.equal(input.userId, "u1");
  assert.equal(input.sessionId, "s1");
  assert.deepEqual(input.knownPreferences, ["four items, collapsed"]);
  assert.equal(input.passages?.[0]?.text, "Termination on 30 days' notice.");
  assert.deepEqual(input.lookups, ["Standup at 10."]);
  assert.equal(input.thread?.[0], "user: Draft the nav");
  assert.deepEqual(input.struggles, []);
});

test("struggles travel as labelled metadata, not as the user's text", () => {
  const message = buildMessage(
    assembleTurnContext({
      uid: "u1",
      sessionId: "s1",
      message: "Explain indemnity again",
      prefs: [],
      passages: [],
      lookups: [],
      thread: [],
      struggles: [{ label: "Indemnity", documentId: "d1", reasked: 2, confidence: 0.3 }],
    }),
  );

  const text = message.parts[0]?.content;
  assert.equal(text?.$case, "text");
  if (text?.$case === "text") {
    assert.equal(text.value, "Explain indemnity again");
    assert.doesNotMatch(text.value, /reasked/);
  }

  const meta = message.metadata as {
    struggles: { label: string; documentId: string }[];
  };
  assert.equal(meta.struggles[0]?.label, "Indemnity");
  assert.equal(meta.struggles[0]?.documentId, "d1");
});

test("the A2A message carries passages as labelled metadata, not as the user's text", () => {
  const message = buildMessage(
    assembleTurnContext({
      uid: "u1",
      sessionId: "s1",
      message: "what's in the contract",
      prefs: [{ now: "four items, collapsed" }],
      passages: [
        {
          chunkId: "c1",
          documentId: "d1",
          title: "Contract.pdf",
          page: 2,
          text: "Termination on 30 days' notice.",
        },
      ],
      lookups: ["Standup at 10."],
      thread: [],
    }),
  );

  const text = message.parts[0]?.content;
  assert.equal(text?.$case, "text");
  if (text?.$case === "text") {
    assert.equal(text.value, "what's in the contract");
    assert.doesNotMatch(text.value, /Termination/);
    assert.doesNotMatch(text.value, /four items/);
  }

  const meta = message.metadata as {
    knownPreferences: string[];
    passages: { text: string }[];
    lookups: string[];
    struggles: unknown[];
  };
  assert.deepEqual(meta.knownPreferences, ["four items, collapsed"]);
  assert.equal(meta.passages[0]?.text, "Termination on 30 days' notice.");
  assert.deepEqual(meta.lookups, ["Standup at 10."]);
  assert.deepEqual(meta.struggles, []);
});
