import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listVisualPreferences,
  rememberVisual,
  swatchesIn,
  visualAspect,
} from "./repos/visual.js";

/**
 * Brand memory. Classification is a pure function and must not need Firestore.
 * Writes run against the emulator and skip loudly when it is absent.
 */

test("too much blue is a palette, softer corners are corners", () => {
  assert.equal(visualAspect("too much blue"), "palette");
  assert.equal(visualAspect("softer corners"), "corners");
  assert.equal(visualAspect("less clutter, more spacing"), "density");
  assert.equal(visualAspect("use the brand typeface"), "typography");
  assert.equal(visualAspect("make it quieter"), "look");
  assert.equal(visualAspect("use #112233 and #fff"), "palette");
});

test("swatches are the hex codes that were actually written, not invented", () => {
  assert.deepEqual(swatchesIn("too much blue"), []);
  assert.deepEqual(swatchesIn("keep #112233, drop #FF00AA"), ["#112233", "#FF00AA"]);
});

test("an empty note teaches nothing", async () => {
  assert.equal(await rememberVisual("anyone", "   "), null);
});

async function emulatorReachable(): Promise<boolean> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return false;
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const live = await emulatorReachable();
if (!live) {
  console.warn("\n  [visual] Firestore emulator not reachable — skipping writes.\n");
}
const emulated = { skip: !live };
const UID = `visual-${Date.now()}`;

test("a correction is applied next time, and a second palette retires the first", emulated, async () => {
  const first = await rememberVisual(UID, "too much blue");
  assert.ok(first);
  const standing = await listVisualPreferences(UID);
  assert.equal(standing.length, 1);
  assert.equal(standing[0]?.aspect, "palette");
  assert.equal(standing[0]?.value, "too much blue");

  await rememberVisual(UID, "softer corners");
  const both = await listVisualPreferences(UID);
  assert.equal(both.length, 2, "different aspects both stand");

  await rememberVisual(UID, "muted, not neon");
  const after = await listVisualPreferences(UID);
  const palettes = after.filter((p) => p.aspect === "palette");
  assert.equal(palettes.length, 1);
  assert.equal(palettes[0]?.value, "muted, not neon");
  assert.ok(after.some((p) => p.aspect === "corners"));
});
