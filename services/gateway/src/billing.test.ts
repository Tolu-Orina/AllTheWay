import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";

import { db } from "./firestore.js";
import { processWebhook, setStripeForTests } from "./billing.js";

/**
 * Billing webhook, against a real Firestore emulator.
 *
 * Signature verification uses Stripe's own test header helper. Retrieve is
 * mocked so these never hit live Stripe. A test that talked to Stripe would
 * pass on a laptop with a key and fail in CI, which is the opposite of a
 * proof.
 */

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const ALICE = `alice-billing-${Date.now()}`;

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
  console.warn(
    "\n  [billing] Firestore emulator not reachable — skipping.\n" +
      "  Start it with:  npx firebase-tools emulators:start --only firestore\n",
  );
}

const emulated = { skip: !live };

function signed(event: object): { payload: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });
  return { payload: Buffer.from(payload), signature };
}

function plusSub(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_plus",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 86_400,
    metadata: { firebaseUid: uid },
    items: {
      data: [{ price: { id: "price_plus", lookup_key: "plus" } }],
    },
    ...overrides,
  };
}

function mockStripe(sub: object, retrieves: { count: number }) {
  return {
    subscriptions: {
      retrieve: async () => {
        retrieves.count += 1;
        return sub;
      },
    },
    customers: {
      retrieve: async () => ({ id: "cus_1", deleted: false, metadata: {} }),
    },
  } as unknown as Stripe;
}

test("a forged webhook is 400 and does not write", emulated, async () => {
  const { payload } = signed({
    id: `evt_forged_${Date.now()}`,
    type: "customer.subscription.created",
    data: { object: plusSub(ALICE) },
  });

  const result = await processWebhook(payload, "t=1,v1=deadbeef");
  assert.equal(result.status, 400);

  const doc = await db.collection("subscriptions").doc(ALICE).get();
  assert.equal(doc.exists, false);
});

test("the same event id is fulfilled once", emulated, async () => {
  const uid = `${ALICE}-replay`;
  const sub = plusSub(uid);
  const retrieves = { count: 0 };
  setStripeForTests(mockStripe(sub, retrieves));

  const event = {
    id: `evt_replay_${Date.now()}`,
    object: "event",
    type: "customer.subscription.created",
    data: { object: sub },
  };
  const { payload, signature } = signed(event);

  const first = await processWebhook(payload, signature);
  const second = await processWebhook(payload, signature);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((second.body as { duplicate?: boolean }).duplicate, true);
  assert.equal(retrieves.count, 1);

  const doc = await db.collection("subscriptions").doc(uid).get();
  assert.equal(doc.get("tier"), "plus");
  assert.equal(doc.get("status"), "active");

  setStripeForTests(undefined);
});

test("a max lookup key upgrades to max", emulated, async () => {
  const uid = `${ALICE}-max`;
  const sub = plusSub(uid, {
    id: "sub_max",
    items: { data: [{ price: { id: "price_max", lookup_key: "max" } }] },
  });
  setStripeForTests(mockStripe(sub, { count: 0 }));

  const { payload, signature } = signed({
    id: `evt_max_${Date.now()}`,
    object: "event",
    type: "customer.subscription.created",
    data: { object: sub },
  });

  const result = await processWebhook(payload, signature);
  assert.equal(result.status, 200);

  const doc = await db.collection("subscriptions").doc(uid).get();
  assert.equal(doc.get("tier"), "max");
  assert.equal(doc.get("status"), "active");

  setStripeForTests(undefined);
});

test("a team lookup key does not upgrade", emulated, async () => {
  const uid = `${ALICE}-team`;
  const sub = plusSub(uid, {
    items: { data: [{ price: { id: "price_team", lookup_key: "team" } }] },
  });
  setStripeForTests(mockStripe(sub, { count: 0 }));

  const { payload, signature } = signed({
    id: `evt_team_${Date.now()}`,
    object: "event",
    type: "customer.subscription.created",
    data: { object: sub },
  });

  const result = await processWebhook(payload, signature);
  assert.equal(result.status, 200);

  const doc = await db.collection("subscriptions").doc(uid).get();
  assert.notEqual(doc.get("tier"), "team");
  assert.notEqual(doc.get("tier"), "plus");
  assert.notEqual(doc.get("tier"), "max");

  setStripeForTests(undefined);
});

test("an enterprise lookup key does not upgrade", emulated, async () => {
  const uid = `${ALICE}-unknown`;
  const sub = plusSub(uid, {
    items: { data: [{ price: { id: "price_enterprise", lookup_key: "enterprise" } }] },
  });
  setStripeForTests(mockStripe(sub, { count: 0 }));

  const { payload, signature } = signed({
    id: `evt_unknown_${Date.now()}`,
    object: "event",
    type: "customer.subscription.created",
    data: { object: sub },
  });

  const result = await processWebhook(payload, signature);
  assert.equal(result.status, 200);

  const doc = await db.collection("subscriptions").doc(uid).get();
  assert.notEqual(doc.get("tier"), "plus");
  assert.notEqual(doc.get("tier"), "max");
  assert.notEqual(doc.get("tier"), "team");

  setStripeForTests(undefined);
});

test("a webhook with no firebase user is 500 so Stripe retries", emulated, async () => {
  const sub = plusSub("", { metadata: {} });
  setStripeForTests(mockStripe(sub, { count: 0 }));

  const eventId = `evt_nouid_${Date.now()}`;
  const { payload, signature } = signed({
    id: eventId,
    object: "event",
    type: "customer.subscription.updated",
    data: { object: sub },
  });

  const result = await processWebhook(payload, signature);
  assert.equal(result.status, 500);

  const claimed = await db.collection("stripeEvents").doc(eventId).get();
  assert.equal(claimed.exists, false);

  setStripeForTests(undefined);
});

test("checkout.session.completed stores the customer and not the tier", emulated, async () => {
  const uid = `${ALICE}-checkout`;
  setStripeForTests(mockStripe(plusSub(uid), { count: 0 }));

  const { payload, signature } = signed({
    id: `evt_cs_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        customer: "cus_checkout",
        client_reference_id: uid,
        metadata: {},
      },
    },
  });

  const result = await processWebhook(payload, signature);
  assert.equal(result.status, 200);

  const doc = await db.collection("subscriptions").doc(uid).get();
  assert.equal(doc.get("stripeCustomerId"), "cus_checkout");
  assert.notEqual(doc.get("tier"), "plus");

  setStripeForTests(undefined);
});
