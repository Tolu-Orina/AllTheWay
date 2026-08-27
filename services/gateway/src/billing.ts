import Stripe from "stripe";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type express from "express";

import { env } from "./env.js";
import { db } from "./firestore.js";

/**
 * Stripe Checkout, Customer Portal, and the webhook that is the only writer
 * of a paid `tier`.
 *
 * Fulfilment always refetches the subscription. Writing Plus from
 * `checkout.session.completed` metadata, then letting `subscription.updated`
 * overwrite with empty metadata, is how a paid user drops back to Free.
 *
 * Empty Stripe env is a supported local state: checkout and portal return 503,
 * the webhook returns 503, and nothing else in the gateway fails to boot.
 */

/** Pinned to the installed package's current default. A minor bump must not
 * reinterpret events because we omitted the field. */
const API_VERSION: Stripe.LatestApiVersion = "2026-08-26.dahlia";

const LOOKUP_PLUS = "plus";
const LOOKUP_MAX = "max";

export type SelfServePlan = "plus" | "max";

class MissingUid extends Error {
  constructor() {
    super("Could not resolve a Firebase user for this Stripe event.");
    this.name = "MissingUid";
  }
}

let testStripe: Stripe | null | undefined;
let cached: Stripe | null | undefined;

export function setStripeForTests(client: Stripe | null | undefined): void {
  testStripe = client;
  cached = undefined;
}

export function stripe(): Stripe | null {
  if (testStripe !== undefined) return testStripe;
  if (cached !== undefined) return cached;
  if (!env.stripeSecretKey) {
    cached = null;
    return null;
  }
  cached = new Stripe(env.stripeSecretKey, { apiVersion: API_VERSION });
  return cached;
}

export function billingOrigin(req: express.Request): string {
  const origin = (req.get("origin") ?? "").replace(/\/$/, "");
  if (env.webOrigins.length === 0) {
    return origin || "http://localhost:5173";
  }
  if (origin && env.webOrigins.includes(origin)) return origin;
  return env.webOrigins[0] ?? origin;
}

async function priceIdFor(client: Stripe, plan: SelfServePlan): Promise<string | null> {
  const override = plan === "plus" ? env.stripePricePlus : env.stripePriceMax;
  if (override) return override;
  const lookup = plan === "plus" ? env.stripeLookupKey || LOOKUP_PLUS : LOOKUP_MAX;
  const listed = await client.prices.list({
    lookup_keys: [lookup],
    active: true,
    limit: 1,
  });
  return listed.data[0]?.id ?? null;
}

function customerIdOf(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function lookupKeyOf(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  if (!price || typeof price === "string") return null;
  return price.lookup_key ?? null;
}

function priceIdOf(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

function tierFromSubscription(sub: Stripe.Subscription): SelfServePlan | null {
  const lookup = lookupKeyOf(sub);
  if (lookup === LOOKUP_PLUS) return "plus";
  if (lookup === LOOKUP_MAX) return "max";
  const id = priceIdOf(sub);
  if (env.stripePricePlus && id === env.stripePricePlus) return "plus";
  if (env.stripePriceMax && id === env.stripePriceMax) return "max";
  return null;
}

function mapStatus(raw: string): "active" | "trialing" | "past_due" | "canceled" | "unpaid" {
  if (raw === "active" || raw === "trialing" || raw === "past_due" || raw === "canceled" || raw === "unpaid") {
    return raw;
  }
  return "unpaid";
}

function periodEndUnix(sub: Stripe.Subscription): number | null {
  const direct = (sub as { current_period_end?: number }).current_period_end;
  if (typeof direct === "number") return direct;
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  if (typeof item?.current_period_end === "number") return item.current_period_end;
  return null;
}

async function claim(eventId: string): Promise<"new" | "seen"> {
  try {
    await db.collection("stripeEvents").doc(eventId).create({
      at: FieldValue.serverTimestamp(),
    });
    return "new";
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code === 6 || code === "already-exists") return "seen";
    throw err;
  }
}

async function release(eventId: string): Promise<void> {
  await db.collection("stripeEvents").doc(eventId).delete();
}

async function uidFromCustomer(client: Stripe, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const customer = await client.customers.retrieve(customerId);
  if (customer.deleted) return null;
  return customer.metadata?.firebaseUid || null;
}

async function resolveUid(event: Stripe.Event, client: Stripe): Promise<string | null> {
  const obj = event.data.object as {
    metadata?: { firebaseUid?: string };
    client_reference_id?: string | null;
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
    id?: string;
  };

  const fromMeta = obj.metadata?.firebaseUid;
  if (fromMeta) return fromMeta;

  if (event.type === "checkout.session.completed") {
    if (obj.client_reference_id) return obj.client_reference_id;
    return uidFromCustomer(client, customerIdOf(obj.customer));
  }

  if (event.type.startsWith("customer.subscription.")) {
    const sub = obj as unknown as Stripe.Subscription;
    if (sub.metadata?.firebaseUid) return sub.metadata.firebaseUid;
    const full = await client.subscriptions.retrieve(sub.id);
    if (full.metadata?.firebaseUid) return full.metadata.firebaseUid;
    return uidFromCustomer(client, customerIdOf(full.customer));
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice & {
      subscription?: string | { id: string };
      parent?: { subscription_details?: { subscription?: string } };
    };
    const nested = invoice.parent?.subscription_details?.subscription;
    const direct = invoice.subscription;
    const subId =
      nested ||
      (typeof direct === "string" ? direct : direct && typeof direct === "object" ? direct.id : null);
    if (subId) {
      const full = await client.subscriptions.retrieve(subId);
      if (full.metadata?.firebaseUid) return full.metadata.firebaseUid;
      return uidFromCustomer(client, customerIdOf(full.customer));
    }
    return uidFromCustomer(client, customerIdOf(invoice.customer));
  }

  return uidFromCustomer(client, customerIdOf(obj.customer));
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session, uid: string): Promise<void> {
  const customerId = customerIdOf(session.customer);
  if (!customerId) return;
  await db.collection("subscriptions").doc(uid).set({ stripeCustomerId: customerId }, { merge: true });
}

async function onSubscriptionWritten(sub: Stripe.Subscription, uid: string, client: Stripe): Promise<void> {
  const full = await client.subscriptions.retrieve(sub.id);
  const mapped = tierFromSubscription(full);
  const customerId = customerIdOf(full.customer);
  const end = periodEndUnix(full);

  if (!mapped) {
    console.error(`[billing] unknown price on ${full.id} uid=${uid} lookup=${lookupKeyOf(full)}`);
    if (customerId) {
      await db.collection("subscriptions").doc(uid).set(
        {
          stripeCustomerId: customerId,
          stripeSubscriptionId: full.id,
        },
        { merge: true },
      );
    }
    return;
  }

  await db.collection("subscriptions").doc(uid).set(
    {
      tier: mapped,
      status: mapStatus(full.status),
      stripeCustomerId: customerId,
      stripeSubscriptionId: full.id,
      currentPeriodEnd: end ? Timestamp.fromMillis(end * 1000) : null,
      priceLookupKey: lookupKeyOf(full),
      cancelAtPeriodEnd: Boolean(full.cancel_at_period_end),
    },
    { merge: true },
  );
}

async function onSubscriptionDeleted(sub: Stripe.Subscription, uid: string, client: Stripe): Promise<void> {
  const full = await client.subscriptions.retrieve(sub.id);
  const customerId = customerIdOf(full.customer);
  await db.collection("subscriptions").doc(uid).set(
    {
      tier: "free",
      status: "canceled",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      priceLookupKey: null,
      cancelAtPeriodEnd: false,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
    { merge: true },
  );
}

async function handleEvent(event: Stripe.Event, client: Stripe): Promise<void> {
  if (event.type === "invoice.payment_failed") {
    const uid = await resolveUid(event, client);
    console.error(`[billing] invoice.payment_failed uid=${uid ?? "unknown"}`);
    return;
  }

  const needsUid =
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted";

  if (!needsUid) return;

  const uid = await resolveUid(event, client);
  if (!uid) throw new MissingUid();

  if (event.type === "checkout.session.completed") {
    await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, uid);
    return;
  }

  const sub = event.data.object as Stripe.Subscription;
  if (event.type === "customer.subscription.deleted") {
    await onSubscriptionDeleted(sub, uid, client);
    return;
  }

  await onSubscriptionWritten(sub, uid, client);
}

export async function processWebhook(
  raw: Buffer | string,
  signature: string | undefined,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.stripeWebhookSecret) {
    return {
      status: 503,
      body: { code: "not_configured", message: "Billing is not configured in this environment." },
    };
  }
  if (!signature) {
    return { status: 400, body: { code: "invalid_signature", message: "Missing signature." } };
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, env.stripeWebhookSecret);
  } catch {
    return { status: 400, body: { code: "invalid_signature", message: "Invalid signature." } };
  }

  const seen = await claim(event.id);
  if (seen === "seen") {
    return { status: 200, body: { received: true, duplicate: true } };
  }

  const client = stripe();
  if (!client) {
    await release(event.id).catch(() => undefined);
    return {
      status: 503,
      body: { code: "not_configured", message: "Billing is not configured in this environment." },
    };
  }

  try {
    await handleEvent(event, client);
    return { status: 200, body: { received: true } };
  } catch (err) {
    await release(event.id).catch(() => undefined);
    console.error("[billing] webhook", event.type, event.id, err);
    return {
      status: 500,
      body: {
        code: err instanceof MissingUid ? "unresolved_user" : "webhook_failed",
        message: err instanceof MissingUid
          ? "Could not resolve a Firebase user for this event."
          : "Webhook handler failed.",
      },
    };
  }
}

export async function startCheckout(
  uid: string,
  origin: string,
  plan: SelfServePlan,
): Promise<{ url: string } | { status: number; error: string }> {
  const client = stripe();
  if (!client) {
    return { status: 503, error: "Billing is not configured in this environment." };
  }

  const existing = await db.collection("subscriptions").doc(uid).get();
  // An active subscriber changing Plus ↔ Max must not open a second
  // subscription. The Customer Portal is where Stripe switches the price on
  // the one they already have.
  if (existing.get("stripeSubscriptionId")) {
    return startPortal(uid, origin);
  }

  let customerId = String(existing.get("stripeCustomerId") ?? "");
  if (!customerId) {
    const customer = await client.customers.create({ metadata: { firebaseUid: uid } });
    customerId = customer.id;
    await db.collection("subscriptions").doc(uid).set({ stripeCustomerId: customerId }, { merge: true });
  }

  const price = await priceIdFor(client, plan);
  if (!price) {
    const label = plan === "max" ? "Max" : "Plus";
    return { status: 503, error: `${label} is not available to buy right now.` };
  }

  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: uid,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/app/you?billing=ok&plan=${plan}`,
    cancel_url: `${origin}/app/you?billing=cancelled`,
    subscription_data: { metadata: { firebaseUid: uid } },
  });

  if (!session.url) {
    return { status: 502, error: "Checkout could not start." };
  }
  return { url: session.url };
}

export async function startPortal(
  uid: string,
  origin: string,
): Promise<{ url: string } | { status: number; error: string }> {
  const client = stripe();
  if (!client) {
    return { status: 503, error: "Billing is not configured in this environment." };
  }

  const existing = await db.collection("subscriptions").doc(uid).get();
  const customerId = String(existing.get("stripeCustomerId") ?? "");
  if (!customerId) {
    return { status: 404, error: "There is no billing account to manage yet." };
  }

  const session = await client.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/app/you`,
  });

  if (!session.url) {
    return { status: 502, error: "The billing portal could not start." };
  }
  return { url: session.url };
}
