import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fallbackShotPrompt,
  mergePlan,
  nextPollDelay,
  parsePlanJson,
  shotDurations,
} from "./studio-shots.js";

test("a two-minute request is fifteen eight-second shots", () => {
  assert.deepEqual(shotDurations(120), Array.from({ length: 15 }, () => 8));
});

test("a remainder shorter than eight seconds is its own last shot", () => {
  assert.deepEqual(shotDurations(20), [8, 8, 4]);
});

test("a single clip is not split", () => {
  assert.deepEqual(shotDurations(8), [8]);
  assert.deepEqual(shotDurations(6), [6]);
});

test("a planner that returns extra shots is truncated to the duration split", () => {
  const merged = mergePlan("a walk through the office", 16, [
    { seconds: 8, prompt: "wide of the lobby" },
    { seconds: 8, prompt: "close on the desk" },
    { seconds: 8, prompt: "unused" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.prompt, "wide of the lobby");
  assert.equal(merged[1]?.prompt, "close on the desk");
});

test("a missing planner falls back to the brief with shot numbers", () => {
  const merged = mergePlan("morning light on a desk", 16, null);
  assert.equal(merged.length, 2);
  assert.match(merged[1]!.prompt, /shot 2 of 2/);
  assert.equal(fallbackShotPrompt("x", 0, 1), "x");
});

test("planner JSON in a fence is still a plan", () => {
  const shots = parsePlanJson('```json\n{"shots":[{"seconds":8,"prompt":"a hallway"}]}\n```');
  assert.equal(shots?.[0]?.prompt, "a hallway");
});

test("poll delay starts at eight seconds and caps at twenty", () => {
  assert.equal(nextPollDelay(0), 8_000);
  assert.equal(nextPollDelay(8_000), 11_200);
  assert.equal(nextPollDelay(20_000), 20_000);
});

test("one clip is already joined", async () => {
  const { concatMp4 } = await import("./join-video.js");
  const buf = Buffer.from("already-one");
  assert.equal(await concatMp4([buf]), buf);
});
