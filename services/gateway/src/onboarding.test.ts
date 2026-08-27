import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { getOnboarding, setOnboarding } from "./repos/onboarding.js";

const UID = `onboarding-${Date.now()}`;

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
  console.warn("\n  [onboarding] Firestore emulator not reachable — skipping.\n");
}
const emulated = { skip: !live };

test("a person who has not been asked has no job", emulated, async () => {
  const row = await getOnboarding(`${UID}-fresh`);
  assert.equal(row.job, null);
  assert.equal(row.lifeContext, null);
});

test("skip is a stored choice, not an absent one", emulated, async () => {
  const uid = `${UID}-skip`;
  const saved = await setOnboarding(uid, { job: "skipped" });
  assert.equal(saved.job, "skipped");
  assert.equal((await getOnboarding(uid)).job, "skipped");
});

test("a job and a life context round-trip", emulated, async () => {
  const uid = `${UID}-talk`;
  await setOnboarding(uid, { job: "talk", lifeContext: "work" });
  const row = await getOnboarding(uid);
  assert.equal(row.job, "talk");
  assert.equal(row.lifeContext, "work");
});

test("an unknown job is refused rather than stored", async () => {
  await assert.rejects(() => setOnboarding(UID, { job: "onboarding-survey" }), {
    name: "ZodError",
  });
});
