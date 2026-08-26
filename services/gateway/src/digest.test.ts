import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";

import { buildDigest, digestDate, markDigestSent } from "./repos/digest.js";
import { ledger, runs, userDoc } from "./firestore.js";

/**
 * The plan's acceptance criterion for this feature is unusually pointed: the
 * digest's counts must reconcile with the ledger, and *a digest that disagrees
 * with the record is worse than none*. These are the ways it could disagree.
 */

const UID = `digest-${Date.now()}`;

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
if (!live) console.warn("\n  [digest] Firestore emulator not reachable — skipping.\n");
const emulated = { skip: !live };

const hoursAgo = (h: number) => Timestamp.fromDate(new Date(Date.now() - h * 3600_000));

test("a run from last night is in this morning's digest", emulated, async () => {
  // A calendar day would show an empty digest every morning: technically
  // correct, and exactly useless at 07:40 on the train.
  await runs(UID).doc("run-overnight").set({
    watcherId: "w1",
    at: hoursAgo(9),
    summary: "Checked the supplier inbox.",
    status: "done",
  });

  const digest = await buildDigest(UID);
  ok(digest.ranWatchers.some((r) => r.summary === "Checked the supplier inbox."));
});

test("a run from last week is not", emulated, async () => {
  await runs(UID).doc("run-old").set({
    watcherId: "w1",
    at: hoursAgo(24 * 7),
    summary: "Ancient history.",
    status: "done",
  });

  const digest = await buildDigest(UID);
  ok(!digest.ranWatchers.some((r) => r.summary === "Ancient history."));
});

test("something awaiting a decision is listed as awaiting", emulated, async () => {
  await runs(UID).doc("run-pending").set({
    watcherId: "w2",
    at: hoursAgo(2),
    summary: "Send the renewal notice to Acme?",
    status: "awaiting_confirmation",
    sessionId: "session-pending",
  });

  const digest = await buildDigest(UID);
  strictEqual(
    digest.awaitingDecision.some((d) => d.summary === "Send the renewal notice to Acme?"),
    true,
  );
});

test("a decision already in the ledger is not asked for twice", emulated, async () => {
  /**
   * The reconciliation criterion, stated as a behaviour.
   *
   * A digest that asks someone to approve what they approved last night is
   * disagreeing with the ledger — and it is the disagreement that costs most,
   * because acting on it either duplicates an action or teaches the reader to
   * ignore the list.
   */
  await runs(UID).doc("run-decided").set({
    watcherId: "w3",
    at: hoursAgo(3),
    summary: "Reply to the invoice query?",
    status: "awaiting_confirmation",
    sessionId: "session-decided",
  });
  await ledger(UID).add({
    sessionId: "session-decided",
    kind: "confirmed",
    summary: "Reply to the invoice query?",
    actions: [],
    modality: "text",
    at: hoursAgo(2),
  });

  const digest = await buildDigest(UID);
  strictEqual(
    digest.awaitingDecision.some((d) => d.summary === "Reply to the invoice query?"),
    false,
    "a decided item was still listed as awaiting",
  );
});

test("the wording someone is asked to approve is verbatim", emulated, async () => {
  // Paraphrasing here would ask a person to approve something they did not
  // read, which is the one thing a confirmation must never do.
  const digest = await buildDigest(UID);
  const pending = digest.awaitingDecision.find((d) => d.id === "run-pending");
  strictEqual(pending?.summary, "Send the renewal notice to Acme?");
});

test("a notification is sent once, however many times delivery is retried", emulated, async () => {
  const uid = `digest-once-${Date.now()}`;
  strictEqual(await markDigestSent(uid), true);
  // At-least-once delivery is the norm, and a second buzz at 07:41 for the
  // same digest reads as the product being broken.
  strictEqual(await markDigestSent(uid), false);

  const digest = await buildDigest(uid);
  ok(digest.sentAt !== null);
});

test("an untouched day reports nothing rather than failing", emulated, async () => {
  const quiet = `digest-quiet-${Date.now()}`;
  const digest = await buildDigest(quiet);

  strictEqual(digest.ranWatchers.length, 0);
  strictEqual(digest.awaitingDecision.length, 0);
  strictEqual(digest.sentAt, null);
  strictEqual(digest.date, digestDate());
});

test("the digest is keyed in UTC, like every other period here", emulated, async () => {
  // A counter that can be reset by travelling is a counter two services
  // disagree about.
  strictEqual(digestDate(new Date("2026-03-01T23:30:00Z")), "2026-03-01");
  strictEqual(digestDate(new Date("2026-03-02T00:30:00Z")), "2026-03-02");
});

test("the stored digest document holds no content", emulated, async () => {
  /**
   * Structural, and deliberately so. The moment content is written here it can
   * disagree with the ledger, which is the failure this design exists to make
   * impossible rather than unlikely.
   */
  const uid = `digest-shape-${Date.now()}`;
  await markDigestSent(uid);

  const doc = await userDoc(uid).collection("digest").doc(digestDate()).get();
  strictEqual(Object.keys(doc.data() ?? {}).join(","), "sentAt");
});
