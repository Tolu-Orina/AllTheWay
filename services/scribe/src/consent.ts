import { getFirestore } from "firebase-admin/firestore";

/**
 * Whether the agent may join a meeting at all (FR-C3).
 *
 * ## Two switches, because they answer different questions
 *
 * A **global** switch answers "should this thing ever be in my meetings" — set
 * once, by someone who has decided. A **per-meeting** opt-out answers "not this
 * one", which is the far more common case: the weekly standup is fine, the
 * disciplinary conversation is not, and being forced to choose between all and
 * nothing means people choose nothing.
 *
 * ## Checked before the ladder, not inside it
 *
 * The tier ladder attempts Tier 2 every time by standing direction. Consent is
 * upstream of that: an opted-out meeting must not produce a connection attempt
 * at all, because attempting is itself visible — every participant sees a
 * dialog when the agent connects. A refusal that still shows the room a dialog
 * has already done the thing the user opted out of.
 *
 * ## Default is off for the meeting, on for the account
 *
 * A meeting with no explicit decision inherits the account setting. An account
 * with no setting is **off**: joining a meeting is the most socially expensive
 * thing this product does, and it should never happen because nobody got round
 * to configuring it.
 */

const db = () => getFirestore();

export interface ConsentDecision {
  allowed: boolean;
  /** Shown to the user afterwards, so a missing meeting is never a mystery. */
  reason: string;
}

/**
 * The decision itself, separated from reading it.
 *
 * Consent is the one control here that cannot be allowed to drift, and a rule
 * that can only be exercised against a live Firestore is a rule that gets
 * tested once and then trusted. As a pure function it is checked on every run,
 * including the case that matters most: neither switch set.
 */
export function decide(
  optedOutOfThisMeeting: boolean,
  globalEnabled: boolean | undefined,
): ConsentDecision {
  // Per-meeting first: an explicit "not this one" beats any account default.
  if (optedOutOfThisMeeting) {
    return { allowed: false, reason: "You asked it to stay out of this meeting." };
  }

  if (globalEnabled !== true) {
    // Off unless switched on. Joining a meeting is the most socially expensive
    // thing this product does, and it must never happen because nobody got
    // round to configuring it. The wording distinguishes "switched off" from
    // "never switched on" so the fix is obvious.
    return {
      allowed: false,
      reason:
        globalEnabled === false
          ? "Meeting notes are switched off for your account."
          : "Meeting notes have not been switched on for your account.",
    };
  }

  return { allowed: true, reason: "" };
}

export async function mayJoin(uid: string, meetingId: string): Promise<ConsentDecision> {
  const user = db().collection("users").doc(uid);

  const perMeeting = await user.collection("meetingOptOuts").doc(meetingId).get();
  const settings = await user.collection("settings").doc("meetings").get();

  return decide(
    perMeeting.exists && perMeeting.get("optedOut") === true,
    settings.exists ? (settings.get("enabled") as boolean | undefined) : undefined,
  );
}

export async function getGlobal(uid: string): Promise<boolean> {
  const settings = await db()
    .collection("users")
    .doc(uid)
    .collection("settings")
    .doc("meetings")
    .get();
  // Same rule as decide(): missing is off, not on.
  return settings.get("enabled") === true;
}

export async function setGlobal(uid: string, enabled: boolean): Promise<void> {
  await db()
    .collection("users")
    .doc(uid)
    .collection("settings")
    .doc("meetings")
    .set({ enabled }, { merge: true });
}

export async function setMeetingOptOut(
  uid: string,
  meetingId: string,
  optedOut: boolean,
): Promise<void> {
  await db()
    .collection("users")
    .doc(uid)
    .collection("meetingOptOuts")
    .doc(meetingId)
    .set({ optedOut }, { merge: true });
}
