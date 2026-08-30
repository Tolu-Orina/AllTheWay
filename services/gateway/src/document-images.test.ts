import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { IMAGE_BACKOFF_MS, fetchWithBackoff, isRetryableStatus, promptHash, retryDelayMs, stillFromBytes } from "./document-images.js";
import { TINY_PNG } from "./document-png.js";

test("429 and 5xx are retried; 400 is not", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(IMAGE_BACKOFF_MS[0], 1_000);
  assert.equal(IMAGE_BACKOFF_MS[4], 16_000);
});

test("Retry-After seconds wins over the attempt ladder", () => {
  assert.equal(retryDelayMs(0, "3", 0), 3_000);
  const fromDate = retryDelayMs(0, new Date(10_000).toUTCString(), 0);
  assert.ok(fromDate >= 250);
});

test("fetchWithBackoff doubles waits and then returns success", async () => {
  const sleeps: number[] = [];
  let n = 0;
  const response = await fetchWithBackoff(
    async () => {
      n += 1;
      if (n < 3) return new Response("busy", { status: 429, headers: { "Retry-After": "1" } });
      return new Response("{}", { status: 200 });
    },
    { sleep: async (ms) => void sleeps.push(ms), attempts: 5 },
  );
  assert.equal(response.status, 200);
  assert.equal(n, 3);
  assert.equal(sleeps.length, 2);
  assert.deepEqual(sleeps, [1_000, 1_000]);
});

test("the same prompt hashes to one cache key", () => {
  assert.equal(promptHash("War-room at dusk"), promptHash("war-room   at dusk"));
  const asset = stillFromBytes("war-room at dusk", TINY_PNG);
  assert.equal(asset.hash, promptHash("war-room at dusk"));
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
});
