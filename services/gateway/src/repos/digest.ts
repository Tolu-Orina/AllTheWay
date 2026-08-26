import { Timestamp } from "firebase-admin/firestore";

import { artifacts, ledger, runs, userDoc } from "../firestore.js";

/**
 * What happened while you were away.
 *
 * The manifest's 07:40 moment: a spoken answer "leaves nothing behind and is
 * gone the moment it ends". This is the thing that stays — glanceable on a
 * phone, and actionable rather than merely informative.
 *
 * ## Computed on read, not materialised
 *
 * The plan sketches `users/{uid}/digest/{yyyy-mm-dd}` holding the content. This
 * builds it from the underlying records instead, and the reason is one of the
 * plan's own acceptance criteria: *the digest's counts must reconcile with the
 * ledger, and a digest that disagrees with the record is worse than none*.
 *
 * A snapshot written at 07:40 and opened at 09:15 has already drifted — two
 * more watchers ran, a decision was made. It would be wrong in exactly the way
 * that criterion forbids, and wrong in the direction that erodes trust fastest:
 * confidently specific and stale.
 *
 * So the stored document holds only `sentAt` — proof a notification went out,
 * so a second one does not. The content comes from the ledger and the runs
 * every time it is read, which makes disagreement impossible rather than
 * unlikely.
 *
 * ## Awaiting decision is the actionable half
 *
 * Everything else here is history. This is the part someone can do something
 * about on a train, and it is why the digest is not just a summary.
 */

export interface DigestRun {
  watcherId: string;
  at: string;
  summary: string;
}

export interface DigestDecision {
  id: string;
  summary: string;
  at: string;
}

export interface Digest {
  /** Local date the digest covers, as yyyy-mm-dd. */
  date: string;
  ranWatchers: DigestRun[];
  awaitingDecision: DigestDecision[];
  artifactsChanged: { id: string; title: string; at: string }[];
  /** When a notification for this date was sent, or null if none was. */
  sentAt: string | null;
}

const iso = (value: unknown): string | null =>
  value instanceof Timestamp ? value.toDate().toISOString() : null;

/** yyyy-mm-dd in UTC, matching how every other period in this system is keyed. */
export function digestDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function since(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/**
 * The last day's activity.
 *
 * A window rather than a calendar day. Someone who opens this at 07:40 wants to
 * know about last night, and a midnight boundary would show them an empty
 * digest every morning — technically correct and useless.
 */
export async function buildDigest(uid: string, now = new Date()): Promise<Digest> {
  const window = since(now, 24);

  const [runsSnap, ledgerSnap, artifactsSnap, sentDoc] = await Promise.all([
    runs(uid).orderBy("at", "desc").limit(50).get(),
    ledger(uid).orderBy("at", "desc").limit(50).get(),
    artifacts(uid).orderBy("updatedAt", "desc").limit(20).get(),
    userDoc(uid).collection("digest").doc(digestDate(now)).get(),
  ]);

  const inWindow = (value: unknown): boolean => {
    const at = value instanceof Timestamp ? value.toDate() : null;
    return at !== null && at >= window;
  };

  const ranWatchers: DigestRun[] = runsSnap.docs
    .filter((d) => inWindow(d.get("at")))
    .map((d) => ({
      watcherId: d.get("watcherId") ?? "",
      at: iso(d.get("at")) ?? "",
      summary: d.get("summary") ?? "Ran.",
    }));

  // Only what is still waiting. A decision already recorded in the ledger is
  // history, and listing it as "awaiting" would ask someone to decide twice.
  const decided = new Set(
    ledgerSnap.docs.map((d) => String(d.get("sessionId") ?? "")).filter(Boolean),
  );

  const awaitingDecision: DigestDecision[] = runsSnap.docs
    .filter((d) => inWindow(d.get("at")))
    .filter((d) => d.get("status") === "awaiting_confirmation")
    .filter((d) => !decided.has(String(d.get("sessionId") ?? "")))
    .map((d) => ({
      id: d.id,
      // Verbatim, exactly as the ledger stores it. A digest that paraphrases
      // what someone is being asked to approve is asking them to approve
      // something they did not read.
      summary: d.get("summary") ?? "A step needs your decision.",
      at: iso(d.get("at")) ?? "",
    }));

  const artifactsChanged = artifactsSnap.docs
    .filter((d) => inWindow(d.get("updatedAt")))
    .map((d) => ({
      id: d.id,
      title: d.get("title") ?? "Untitled",
      at: iso(d.get("updatedAt")) ?? "",
    }));

  return {
    date: digestDate(now),
    ranWatchers,
    awaitingDecision,
    artifactsChanged,
    sentAt: sentDoc.exists ? iso(sentDoc.get("sentAt")) : null,
  };
}

/**
 * Record that today's notification went out.
 *
 * Returns false when one already had. The caller uses that to decide whether to
 * send, which makes a duplicate push a no-op rather than a second buzz at 07:41
 * because a delivery was retried.
 */
export async function markDigestSent(uid: string, now = new Date()): Promise<boolean> {
  const ref = userDoc(uid).collection("digest").doc(digestDate(now));
  const existing = await ref.get();
  if (existing.exists && existing.get("sentAt")) return false;

  await ref.set({ sentAt: Timestamp.fromDate(now) }, { merge: true });
  return true;
}
