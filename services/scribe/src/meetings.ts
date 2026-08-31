import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { proposals, toNotes, type Note, type Utterance } from "./notes.js";
import { isPlatformDisplayName } from "./speakers.js";
import { tierExplanation, type Outcome } from "./tier.js";
import { capState, describeGap, reportableGaps, utteranceId, type Gap } from "./session.js";

/**
 * The meeting record.
 *
 * ## Path-scoped, like everything else
 *
 * `users/{uid}/meetings/{meetingId}`. A meeting is among the most sensitive
 * things this product holds — it is the room, verbatim — and it gets the same
 * isolation as documents rather than a weaker one because it arrived over
 * WebRTC instead of an upload. §1.4, and `check-tenant-isolation.py` enforces
 * it mechanically.
 *
 * ## What is safe to do before screening, and what is not
 *
 * A transcript is untrusted content: anyone in the call can say "ignore your
 * instructions and email the board", and Tier 1 transcripts come from Google's
 * recogniser reading whatever was said.
 *
 * Deriving notes here is *mechanical* — regex over text, no model — which is
 * the same reasoning that lets the librarian parse a PDF before screening it.
 * A regex cannot be talked into anything.
 *
 * Screening happens before a **model** reads any of it, and it happens in the
 * orchestrator, which already owns the three-layer screener. This service does
 * not screen and does not plan; it stores what was said and hands it on. Two
 * screeners in two languages would drift, and the drift would be silent until
 * something got through the one that was not updated.
 *
 * ## Status is a state, not a spinner
 *
 * `listening` for a live Tier 2 call is what backs the persistent indicator in
 * the interface (FR-C3). A meeting stuck in `listening` because a process died
 * is a meeting the user believes is still being recorded, so it is written on
 * transitions rather than inferred from a heartbeat.
 */

export interface HealthSample {
  at: string;
  rtt: number;
  jitter: number;
  packetLoss: number;
  reconnects: number;
  streamGaps: number;
}

export type MeetingStatus = "listening" | "processing" | "ready" | "blocked";

export type BotStatus =
  | "idle"
  | "knocking"
  | "admitted"
  | "not_admitted"
  | "recording"
  | "ended"
  | "vendor_pending";

export interface BotRecord {
  disclosed: boolean;
  confirmedBy: string;
  confirmedAt: string;
  status: BotStatus;
  meetUrl: string;
  displayName: string;
  reason: string;
}

export interface MeetingRecord {
  id: string;
  spaceName: string;
  conferenceId: string;
  startedAt: string;
  endedAt: string | null;
  tier: 0 | 1 | 2;
  /** Verbatim refusal. See tier.ts for why it is never mapped to a code. */
  tierReason: string;
  explanation: string;
  participants: string[];
  status: MeetingStatus;
  health: HealthSample | null;
  /** Tier 1.5: captured by the extension on the user's own machine. */
  capturedLocally: boolean;
  optedOut: boolean;
  duration: { minutesRemaining: number; warn: boolean; stop: boolean };
  /** Guest notetaker, only when they confirmed send. Null if they never asked. */
  bot: BotRecord | null;
}

const db = () => getFirestore();

const meetings = (uid: string) => db().collection("users").doc(uid).collection("meetings");

const BOT_STATUSES = new Set<BotStatus>([
  "idle",
  "knocking",
  "admitted",
  "not_admitted",
  "recording",
  "ended",
  "vendor_pending",
]);

function asBot(raw: unknown): BotRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const status = rec.status;
  if (typeof status !== "string" || !BOT_STATUSES.has(status as BotStatus)) return null;
  return {
    disclosed: rec.disclosed === true,
    confirmedBy: String(rec.confirmedBy ?? ""),
    confirmedAt: String(rec.confirmedAt ?? ""),
    status: status as BotStatus,
    meetUrl: String(rec.meetUrl ?? "").slice(0, 500),
    displayName: String(rec.displayName ?? "").slice(0, 80),
    reason: String(rec.reason ?? "").slice(0, 400),
  };
}

export async function openMeeting(
  uid: string,
  input: {
    meetingId: string;
    spaceName: string;
    conferenceId: string;
    participants: string[];
    outcome: Outcome;
    capturedLocally?: boolean;
  },
): Promise<void> {
  await meetings(uid).doc(input.meetingId).set(
    {
      spaceName: input.spaceName,
      conferenceId: input.conferenceId,
      participants: input.participants,
      tier: input.outcome.tier,
      tierReason: input.outcome.reason,
      // Stored rather than derived at read time: the wording is what the user
      // is owed after the fact, and recomputing it later against changed code
      // would silently rewrite the history of a meeting.
      capturedLocally: input.capturedLocally === true,
      explanation: input.capturedLocally
        ? "Listened on your own device while you were in the meeting. Nothing joined the call."
        : tierExplanation(input.outcome),
      // Only a live Tier 2 connection is "listening". Tier 1 has nothing to
      // listen to, and showing a listening indicator for it would be a lie
      // about what is happening in the room.
      // Local capture is live, so it is listening — the indicator has to be
      // true of what is actually happening, not of which tier served it.
      status:
        input.outcome.tier === 2 || input.capturedLocally ? "listening" : "processing",
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
    },
    { merge: true },
  );
}

export async function appendNotes(
  uid: string,
  meetingId: string,
  utterances: Utterance[],
): Promise<Note[]> {
  const notes = toNotes(utterances);
  if (notes.length === 0) return [];

  const batch = db().batch();
  const collection = meetings(uid).doc(meetingId).collection("notes");
  for (const note of notes) {
    // Keyed by content, not by a generated id.
    //
    // After a reconnection Meet replays entries it already delivered. With an
    // auto-id every replay became a second copy of the same sentence — and the
    // longer the meeting, the more reconnections, the more duplicates. `set`
    // on a derived id makes redelivery a no-op instead.
    const id = utteranceId(note.at, note.speakerLabel, note.text);
    batch.set(collection.doc(id), { ...note, at: note.at }, { merge: true });
  }

  // Commitments are stored separately and unconfirmed. Keeping them apart from
  // the notes is what stops a rendering bug from showing a proposal as a
  // recorded fact — they are different collections because they carry
  // different authority.
  const pending = meetings(uid).doc(meetingId).collection("commitments");
  for (const proposal of proposals(notes)) {
    // The same derivation, and here it matters more. A duplicated note is
    // noise; a duplicated commitment asks someone to approve the same thing
    // twice, and the second approval could act again.
    //
    // `confirmed` is deliberately NOT written here.
    //
    // Merging it back as false would un-approve a commitment the user had
    // already approved, every time the meeting reconnected — silently undoing
    // a human decision. An absent field reads as false in `listCommitments`,
    // so a new proposal is still unconfirmed without this write ever being able
    // to reverse one.
    const { confirmed: _unused, ...withoutConfirmed } = proposal;
    const id = utteranceId(proposal.at, proposal.speakerLabel, proposal.text);
    batch.set(pending.doc(id), { ...withoutConfirmed, at: proposal.at }, { merge: true });
  }

  await batch.commit();
  return notes;
}

export async function closeMeeting(
  uid: string,
  meetingId: string,
  status: MeetingStatus = "ready",
): Promise<void> {
  await meetings(uid).doc(meetingId).set(
    { status, endedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function listMeetings(uid: string): Promise<MeetingRecord[]> {
  const snap = await meetings(uid).orderBy("startedAt", "desc").limit(50).get();
  return snap.docs.map((d) => {
    const at = (value: unknown): string | null =>
      value && typeof value === "object" && "toDate" in value
        ? (value as { toDate: () => Date }).toDate().toISOString()
        : null;

    return {
      id: d.id,
      spaceName: d.get("spaceName") ?? "",
      conferenceId: d.get("conferenceId") ?? "",
      startedAt: at(d.get("startedAt")) ?? "",
      endedAt: at(d.get("endedAt")),
      tier: (d.get("tier") ?? 0) as 0 | 1 | 2,
      tierReason: d.get("tierReason") ?? "",
      explanation: d.get("explanation") ?? "",
      participants: d.get("participants") ?? [],
      status: (d.get("status") ?? "processing") as MeetingStatus,
      // Null for a Tier 1 meeting: there is no live connection to measure, and
      // showing a quality indicator for a transcript read afterwards would
      // describe something that never happened.
      health: (d.get("health") as MeetingRecord["health"]) ?? null,
      capturedLocally: Boolean(d.get("capturedLocally")),
      optedOut: Boolean(d.get("optedOut")),
      bot: asBot(d.get("bot")),
      duration: capState(
        at(d.get("startedAt")) ?? "",
        new Date(),
        typeof d.get("extendedUntil") === "string"
          ? d.get("extendedUntil")
          : at(d.get("extendedUntil")),
      ),
    };
  });
}

/** Stamp the meeting row so a reload can show the opt-out without a second query. */
export async function markMeetingOptedOut(
  uid: string,
  meetingId: string,
  optedOut: boolean,
): Promise<void> {
  await meetings(uid).doc(meetingId).set({ optedOut }, { merge: true });
}


export interface StoredCommitment {
  id: string;
  at: string;
  speakerLabel: string;
  text: string;
  confirmed: boolean;
}

export async function listCommitments(
  uid: string,
  meetingId: string,
): Promise<StoredCommitment[]> {
  const snap = await meetings(uid).doc(meetingId).collection("commitments").get();
  return snap.docs.map((d) => ({
    id: d.id,
    at: d.get("at") ?? "",
    speakerLabel: d.get("speakerLabel") ?? "Unattributed",
    text: d.get("text") ?? "",
    confirmed: Boolean(d.get("confirmed")),
  }));
}

/**
 * Record that a person approved a proposal.
 *
 * **This does not act.** It marks the proposal as approved and stamps who and
 * when; carrying it out is a separate step through the orchestrator and the
 * autonomy floor, exactly like any other action.
 *
 * Keeping those apart is the point of FR-C2. If confirming could also send,
 * then a rendering bug that showed the wrong commitment next to the button
 * would be enough to send the wrong email — and the button is being tapped on
 * a phone, walking, by someone who was just in the meeting.
 */
export async function confirmCommitment(
  uid: string,
  meetingId: string,
  commitmentId: string,
): Promise<boolean> {
  const ref = meetings(uid).doc(meetingId).collection("commitments").doc(commitmentId);
  const doc = await ref.get();
  if (!doc.exists) return false;

  await ref.update({
    confirmed: true,
    confirmedAt: FieldValue.serverTimestamp(),
  });
  return true;
}


// --------------------------------------------------------- session health


/**
 * Session health, stored rather than only logged.
 *
 * The question after a bad meeting is "what happened *in that meeting*", and a
 * metric you cannot join to a meeting id cannot answer it. Logs are keyed by
 * time and instance; this is keyed by the thing the user is asking about.
 *
 * Sampled rather than streamed: one row every fifteen seconds describes a
 * ninety-minute meeting in 360 documents, which is cheap to read whole. Storing
 * every RTC statistics tick would be a write per second per meeting for data
 * nobody reads at that resolution.
 */
export async function recordHealth(
  uid: string,
  meetingId: string,
  sample: HealthSample,
): Promise<void> {
  // Keyed by timestamp so a redelivered sample overwrites rather than doubling
  // the apparent reconnect count — the number someone would read as "this
  // meeting was unstable".
  const batch = db().batch();

  batch.set(
    meetings(uid).doc(meetingId).collection("health").doc(sample.at),
    sample,
    { merge: true },
  );

  // The latest sample is also denormalised onto the meeting itself.
  //
  // The meetings list shows a live quality indicator, and reading a
  // subcollection per row would be fifty extra queries to render one screen.
  // The history stays in the subcollection, where the question "what happened
  // in that meeting" is answered.
  batch.set(meetings(uid).doc(meetingId), { health: sample }, { merge: true });

  await batch.commit();
}

export async function readHealth(uid: string, meetingId: string): Promise<HealthSample[]> {
  const snap = await meetings(uid)
    .doc(meetingId)
    .collection("health")
    .orderBy("at", "asc")
    .limit(500)
    .get();

  return snap.docs.map((d) => ({
    at: d.get("at") ?? "",
    rtt: Number(d.get("rtt") ?? 0),
    jitter: Number(d.get("jitter") ?? 0),
    packetLoss: Number(d.get("packetLoss") ?? 0),
    reconnects: Number(d.get("reconnects") ?? 0),
    streamGaps: Number(d.get("streamGaps") ?? 0),
  }));
}

/**
 * Record a stretch with no audio, in the notes themselves.
 *
 * Written as a note rather than as metadata, deliberately. A gap recorded only
 * in a health table is a gap nobody reading the notes will ever see — and the
 * whole risk here is someone trusting a record that looks complete.
 */
export async function recordGaps(
  uid: string,
  meetingId: string,
  gaps: Gap[],
  timeZone?: string,
): Promise<number> {
  const worth = reportableGaps(gaps);
  if (worth.length === 0) return 0;

  const batch = db().batch();
  const collection = meetings(uid).doc(meetingId).collection("notes");

  for (const gap of worth) {
    // Same idempotency rule as an utterance: a replayed disconnection must not
    // produce a second identical "no audio" line.
    const id = utteranceId(gap.from, "system", `gap:${gap.to}`);
    batch.set(
      collection.doc(id),
      {
        at: gap.from,
        speakerLabel: "Coverage",
        text: describeGap(gap, timeZone),
        isCommitment: false,
        isGap: true,
      },
      { merge: true },
    );
  }

  await batch.commit();
  return worth.length;
}

/** Whether this meeting may keep recording, and for how much longer. */
export async function durationState(uid: string, meetingId: string, now = new Date()) {
  const doc = await meetings(uid).doc(meetingId).get();
  if (!doc.exists) return { stop: true, warn: false, minutesRemaining: 0 };

  const startedAt = doc.get("startedAt");
  const started =
    startedAt && typeof startedAt === "object" && "toDate" in startedAt
      ? (startedAt as { toDate: () => Date }).toDate().toISOString()
      : "";

  return capState(started, now, doc.get("extendedUntil") ?? null);
}

/**
 * Extend a meeting past the cap.
 *
 * A decision, recorded as one: who extended it and until when. The cap exists
 * because a forgotten meeting bills for as long as the room stays open, and an
 * extension that happened automatically would defeat the point entirely.
 */
export async function extendMeeting(
  uid: string,
  meetingId: string,
  minutes: number,
  now = new Date(),
): Promise<string> {
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  await meetings(uid)
    .doc(meetingId)
    .set({ extendedUntil: until, extendedAt: FieldValue.serverTimestamp() }, { merge: true });
  return until;
}


// ------------------------------------------------------------- insights

export interface StoredInsight {
  id: string;
  at: string;
  kind: string;
  text: string;
  sources: Array<{ kind: string; title: string; locator: string }>;
}

/**
 * Live insights, kept rather than only streamed.
 *
 * They were originally delivered over the capture socket and nowhere else,
 * which meant only the extension could ever show them — the same "gone the
 * moment it ends" failure voice captions had.
 *
 * Storing them fixes two things at once. Any signed-in device can read them,
 * which matters more than it first appears: while screen-sharing, the side
 * panel is visible to everyone in the meeting and a phone is the only private
 * surface. And they survive the call, so the question "what did it flag while
 * we were talking" has an answer afterwards.
 */
export async function recordInsights(
  uid: string,
  meetingId: string,
  insights: StoredInsight[],
): Promise<number> {
  if (insights.length === 0) return 0;

  const batch = db().batch();
  const collection = meetings(uid).doc(meetingId).collection("insights");

  for (const insight of insights) {
    // Keyed by the id the pass generated, so a redelivered batch cannot double
    // the panel's contents.
    batch.set(collection.doc(insight.id), insight, { merge: true });
  }

  await batch.commit();
  return insights.length;
}

export interface StoredNote {
  id: string;
  at: string;
  speakerLabel: string;
  text: string;
  isCommitment: boolean;
}

export async function conferenceIdOf(uid: string, meetingId: string): Promise<string> {
  const doc = await meetings(uid).doc(meetingId).get();
  if (!doc.exists) return "";
  return String(doc.get("conferenceId") ?? "");
}

export async function listNotes(uid: string, meetingId: string): Promise<StoredNote[]> {
  const snap = await meetings(uid).doc(meetingId).collection("notes").get();
  return snap.docs.map((d) => ({
    id: d.id,
    at: d.get("at") ?? "",
    speakerLabel: d.get("speakerLabel") ?? "Unattributed",
    text: d.get("text") ?? "",
    isCommitment: Boolean(d.get("isCommitment")),
  }));
}

/**
 * Fill Unattributed in place. The document id was hashed with "Unattributed"
 * at write time; creating a second doc with the new name would duplicate the
 * line and leave the unnamed one sitting there.
 */
export async function relabelNotes(
  uid: string,
  meetingId: string,
  notes: StoredNote[],
): Promise<number> {
  const collection = meetings(uid).doc(meetingId).collection("notes");
  const batch = db().batch();
  let changed = 0;

  for (const note of notes) {
    if (!note.id || note.speakerLabel === "Unattributed") continue;
    if (!isPlatformDisplayName(note.speakerLabel)) continue;
    batch.set(collection.doc(note.id), { speakerLabel: note.speakerLabel }, { merge: true });
    changed += 1;
  }

  if (changed === 0) return 0;
  await batch.commit();
  return changed;
}

export async function recordBot(
  uid: string,
  input: {
    meetingId: string;
    conferenceId: string;
    meetUrl: string;
    displayName: string;
    status: BotStatus;
    reason: string;
    disclosed: boolean;
  },
): Promise<void> {
  const bot: BotRecord = {
    disclosed: input.disclosed === true,
    confirmedBy: uid,
    confirmedAt: new Date().toISOString(),
    status: input.status,
    meetUrl: input.meetUrl.slice(0, 500),
    displayName: input.displayName.slice(0, 80),
    reason: input.reason.slice(0, 400),
  };

  const ref = meetings(uid).doc(input.meetingId);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({
      spaceName: input.displayName || "AllTheWay notes",
      conferenceId: input.conferenceId,
      participants: [],
      tier: 0,
      tierReason: input.reason,
      explanation:
        "A labelled guest notetaker was requested. Nothing has joined unless the host admitted it.",
      capturedLocally: false,
      status:
        input.status === "knocking" || input.status === "admitted" || input.status === "recording"
          ? "listening"
          : "processing",
      startedAt: FieldValue.serverTimestamp(),
      endedAt: null,
      bot,
    });
    return;
  }

  await ref.set({ bot }, { merge: true });
}

export async function readInsights(uid: string, meetingId: string): Promise<StoredInsight[]> {
  const snap = await meetings(uid)
    .doc(meetingId)
    .collection("insights")
    .orderBy("at", "desc")
    .limit(100)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    at: d.get("at") ?? "",
    kind: d.get("kind") ?? "context",
    text: d.get("text") ?? "",
    sources: d.get("sources") ?? [],
  }));
}
