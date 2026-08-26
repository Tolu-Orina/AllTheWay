/**
 * Which tier serves a meeting, decided by attempting the best one every time.
 *
 * ## "Tier 2 by default" is an instruction about *attempting*, not requiring
 *
 * Tier 2 is the Meet Media API: a receive-only WebRTC client that produces
 * notes while the call is happening. It is a Developer Preview, and it refuses
 * for reasons that are entirely outside this product's control — the project,
 * the OAuth principal and *every participant* must be enrolled, and it declines
 * underage accounts, encrypted meetings and watermarked meetings outright.
 *
 * A build that required Tier 2 would therefore be a build that fails on most
 * real meetings. A build that defaulted to Tier 1 to be safe would never
 * discover which refusals actually happen. So: attempt Tier 2 every time,
 * record verbatim why it refused, fall to Tier 1, and say so afterwards.
 *
 * ## Silent in the moment, explicit afterwards
 *
 * Nobody wants an error dialog during a client call. Everybody wants to know
 * afterwards why there are no live notes. That is why a refusal produces a
 * stored reason rather than a thrown error: the meeting still happens, still
 * gets notes from Tier 1, and the record says which tier served it and why.
 *
 * ## The reason is stored verbatim, never mapped to a code
 *
 * Mapping refusals to an enum would require knowing the refusal set in advance.
 * It belongs to a preview programme that can change it without telling us, and
 * an unmapped string is the only thing that will show which refusals happen in
 * practice. The cost is an unbounded value in Firestore; the benefit is
 * learning something true.
 */

/** 2 = live Meet Media, 1 = post-call transcript, 0 = neither was possible. */
export type Tier = 2 | 1 | 0;

export interface Attempt {
  /** Resolves when connected; rejects with the refusal for anything else. */
  connect: () => Promise<void>;
}

export interface Outcome {
  tier: Tier;
  /**
   * Why the better tier was not used. Empty when Tier 2 connected.
   *
   * Written for the person who opens the meeting afterwards and wonders where
   * the live notes were — so it names the cause, not the layer that raised it.
   */
  reason: string;
}

/**
 * The refusal text, made safe to store and show.
 *
 * Bounded because it is attacker-adjacent: it originates outside this system
 * and ends up in a document and on a screen. Flattened to one line for the
 * same reason a trace entry is — a stored reason that can inject newlines into
 * a log is a stored reason that can forge log entries.
 */
export function refusalText(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Meet Media API refused the connection without a reason.";

  const flattened = raw.replace(/\s+/g, " ").trim();
  if (flattened.length === 0) {
    // An empty message is not "no problem" — it is a refusal we failed to
    // capture, and saying so is more useful than storing "".
    return "Meet Media API refused the connection without a reason.";
  }
  return flattened.length > 500 ? `${flattened.slice(0, 500)}…` : flattened;
}

/**
 * Attempt Tier 2, then Tier 1, then give up honestly.
 *
 * Never throws. A meeting that cannot be served is a meeting recorded as
 * `tier: 0` with a reason — because the alternative is an exception on a path
 * where the user is in a call and there is nothing they can do about it.
 */
export async function resolveTier(
  tier2: Attempt,
  tier1: Attempt,
): Promise<Outcome> {
  try {
    await tier2.connect();
    return { tier: 2, reason: "" };
  } catch (error) {
    const reason = refusalText(error);

    try {
      await tier1.connect();
      return { tier: 1, reason };
    } catch (fallbackError) {
      // Both reasons are kept. Debugging "no notes" with only the second one
      // means never learning that Tier 2 was refused for an unrelated cause.
      return {
        tier: 0,
        reason: `Live notes unavailable: ${reason} Transcript unavailable: ${refusalText(fallbackError)}`,
      };
    }
  }
}

/** What the meeting record shows a person. Never implies the agent spoke. */
export function tierExplanation(outcome: Outcome): string {
  switch (outcome.tier) {
    case 2:
      // FR-C4: the Media API is receive-only. The wording never suggests
      // otherwise, because a user who believes it can speak will eventually
      // rely on it doing so.
      return "Listened live and took notes as the meeting happened.";
    case 1:
      return `Read the transcript after the meeting. Live notes were not available: ${outcome.reason}`;
    default:
      return `No notes for this meeting. ${outcome.reason}`;
  }
}
