import "../test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { SpokenHangup } from "./hangup.js";

const fast = { silentMs: 25, playoutMs: 30, watchdogMs: 120 };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("spoken hangup closes after a silent wait when the model never speaks", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  assert.equal(spoken.arm("c1"), true);
  assert.equal(spoken.pending, true);
  await wait(80);
  assert.equal(hung, 1);
  assert.equal(spoken.settled, true);
});

test("spoken hangup waits for farewell PCM then turnComplete before closing", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.onPcm();
  await wait(50);
  assert.equal(hung, 0, "PCM alone must not hang up — the goodbye may still be generating");
  spoken.onTurnComplete();
  await wait(20);
  assert.equal(hung, 0, "must drain playout after turnComplete");
  await wait(40);
  assert.equal(hung, 1);
});

test("trailing PCM after turnComplete extends the drain so the goodbye is not cut", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.onTurnComplete();
  spoken.onPcm();
  await wait(20);
  assert.equal(hung, 0);
  await wait(40);
  assert.equal(hung, 1);
});

test("barge-in cancels a pending hangup", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.onInterrupted();
  await wait(150);
  assert.equal(hung, 0);
  assert.equal(spoken.pending, false);
});

test("toolCallCancellation of this call cancels hangup; other ids do not", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.onCancel(["other"]);
  await wait(80);
  assert.equal(hung, 1);

  hung = 0;
  const spoken2 = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken2.arm("c2");
  spoken2.onCancel(["c2"]);
  await wait(150);
  assert.equal(hung, 0);
});

test("a second arm is ignored so goodbye is not scheduled twice", () => {
  const spoken = new SpokenHangup(() => undefined, fast);
  assert.equal(spoken.arm("c1"), true);
  assert.equal(spoken.arm("c1"), false);
  assert.equal(spoken.arm("c2"), false);
  spoken.dispose();
});

test("dispose prevents a later fire", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.dispose();
  await wait(150);
  assert.equal(hung, 0);
});

test("watchdog hangs up if turnComplete never arrives after audio", async () => {
  let hung = 0;
  const spoken = new SpokenHangup(() => {
    hung += 1;
  }, fast);
  spoken.arm("c1");
  spoken.onPcm();
  await wait(80);
  assert.equal(hung, 0);
  await wait(80);
  assert.equal(hung, 1);
});
