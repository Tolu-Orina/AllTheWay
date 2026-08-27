import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import { sessions, userDoc } from "../firestore.js";

/**
 * Keeping what was said in a voice conversation.
 *
 * ## Off unless switched on
 *
 * Voice has always been ephemeral: transcripts stream to the browser as
 * captions, overwrite each other, and are gone when the session closes. Some
 * people rely on that, and turning it on for everyone would be a change in what
 * this product remembers about a person — not a feature they opted into.
 *
 * So it is a setting, defaulted off, and read on every write rather than cached.
 * A user who switches it off mid-conversation stops being recorded from that
 * moment, which is the behaviour the switch appears to promise.
 *
 * ## What is kept, and what is not
 *
 * Finished utterances only. The Live API emits a transcript repeatedly as it
 * refines it — "I'll send", "I'll send the", "I'll send the contract" — and
 * storing every revision would triple the volume to record the same sentence
 * three times, in progressively less wrong forms.
 *
 * ## Why it is not screened on the way in
 *
 * FR-C1 requires screening before a **model** reads untrusted content. Nothing
 * reads this on write: it is stored and shown back to the person who said it.
 * Screening happens where a model is involved — the same rule meetings follow,
 * applied at the same boundary rather than a different one.
 */

export interface TranscriptLine {
  /** "user" for the person, "model" for the companion's reply. */
  side: "user" | "model";
  text: string;
  at: string;
}

/**
 * Content-derived, so a redelivered or re-refined line cannot become a second
 * copy. The same reasoning as the scribe's utterance ids.
 */
function lineId(side: string, at: string, text: string): string {
  return createHash("sha256").update(`${side} ${at} ${text.trim()}`).digest("hex").slice(0, 32);
}

export async function keepsTranscripts(uid: string): Promise<boolean> {
  try {
    const doc = await userDoc(uid).collection("settings").doc("voice").get();
    return doc.exists && doc.get("keepTranscripts") === true;
  } catch {
    // Unreadable settings mean "not switched on". The failure direction matters
    // here: guessing yes would record someone who never asked to be.
    return false;
  }
}

export async function setKeepTranscripts(uid: string, keep: boolean): Promise<void> {
  await userDoc(uid)
    .collection("settings")
    .doc("voice")
    .set({ keepTranscripts: keep, changedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/**
 * Store one finished line, if this user keeps transcripts.
 *
 * Returns whether it was kept, so a caller can tell "not kept" from "failed" —
 * the two need different answers and only one is worth reporting.
 */
export async function recordLine(
  uid: string,
  sessionId: string,
  line: TranscriptLine,
): Promise<boolean> {
  if (!line.text.trim()) return false;
  if (!(await keepsTranscripts(uid))) return false;

  await sessions(uid)
    .doc(sessionId)
    .collection("transcript")
    .doc(lineId(line.side, line.at, line.text))
    .set(line, { merge: true });

  return true;
}

export async function readTranscript(
  uid: string,
  sessionId: string,
): Promise<TranscriptLine[]> {
  const snap = await sessions(uid)
    .doc(sessionId)
    .collection("transcript")
    .orderBy("at", "asc")
    .limit(2000)
    .get();

  return snap.docs.map((d) => ({
    side: d.get("side") === "model" ? "model" : "user",
    text: d.get("text") ?? "",
    at: d.get("at") ?? "",
  }));
}

/**
 * Delete a conversation's transcript.
 *
 * Present because the setting alone is not enough. Switching recording off stops
 * new lines; it does not answer "and remove what you already have", which is the
 * next thing anyone asks. A record kept after someone asked for it to go is
 * worse than never having offered the feature.
 */
export async function forgetTranscript(uid: string, sessionId: string): Promise<number> {
  const collection = sessions(uid).doc(sessionId).collection("transcript");

  // Batched, and looped here rather than by the caller. Firestore caps a write
  // batch, and a two-hour conversation exceeds it — but making the client
  // orchestrate that would mean "delete this" depends on the client finishing
  // the loop, and a closed tab would leave half a record behind.
  let removed = 0;
  for (let pass = 0; pass < 40; pass += 1) {
    const snap = await collection.limit(400).get();
    if (snap.empty) break;

    const batch = collection.firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
  }

  return removed;
}
