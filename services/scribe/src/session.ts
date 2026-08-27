import { createHash } from "node:crypto";

/**
 * Making a long meeting survivable.
 *
 * Phase D made Tier 2 *work*. This is the difference between that and holding
 * up for ninety minutes on hotel wifi — a different engineering problem, and
 * the one that gets skipped when the two are conflated.
 *
 * Everything here is a pure function over state. That is deliberate: Tier 2
 * itself cannot be exercised until the Developer Preview admits this project,
 * so the parts that *can* be proven now are separated from the parts that
 * cannot. When enrolment arrives, the reconnect policy, the gap arithmetic and
 * the duration cap are already known-good; only the transport is new.
 *
 * ## The worst outcome is silent degradation
 *
 * Notes that look complete but are not will be trusted, and acted on. So the
 * bias throughout is: when coverage is uncertain, say so. A labelled gap is a
 * small embarrassment; an unlabelled one is a meeting someone believes they
 * have a full record of.
 */

// ---------------------------------------------------------------- reconnect

/** Matches the voice relay's ceiling. Same failure, same bound. */
export const MAX_RECONNECT_ATTEMPTS = 5;

const BASE_PAUSE_MS = 250;
const MAX_PAUSE_MS = 8_000;

export interface ReconnectDecision {
  retry: boolean;
  delayMs: number;
  /** Why it stopped. Empty while it is still retrying. */
  reason: string;
}

/**
 * Whether to try again, and how long to wait.
 *
 * Exponential, capped, and jittered. The cap matters because 2^5 of a quarter
 * second is already eight seconds and doubling further only delays the honest
 * answer. The jitter matters because a Cloud Run instance holding several
 * meetings would otherwise reconnect all of them in the same instant after a
 * network blip — a reconnect storm of our own making.
 *
 * `random` is injectable so the jitter can be tested rather than hoped at.
 */
export function reconnectAfter(
  attempt: number,
  random: () => number = Math.random,
): ReconnectDecision {
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    return {
      retry: false,
      delayMs: 0,
      // Said in terms of the meeting, not the socket. Whoever reads this later
      // wants to know their notes stopped, not that a WebSocket did.
      reason: `Lost the connection to this meeting after ${MAX_RECONNECT_ATTEMPTS} attempts to rejoin.`,
    };
  }

  const backoff = Math.min(BASE_PAUSE_MS * 2 ** Math.max(attempt - 1, 0), MAX_PAUSE_MS);
  // Full jitter across the window rather than a fixed fraction: it spreads
  // simultaneous reconnects over the whole interval instead of clustering them.
  return { retry: true, delayMs: Math.floor(backoff * random()), reason: "" };
}

// --------------------------------------------------------------------- gaps

export interface Gap {
  from: string;
  to: string;
}

/**
 * Blips below this are not reported.
 *
 * A 300ms renegotiation loses nothing a person would notice, and labelling it
 * would bury the gaps that matter under noise — which is its own kind of
 * silence. Two seconds is roughly the shortest interval in which a sentence can
 * go missing.
 */
export const GAP_THRESHOLD_MS = 2_000;

export function isReportableGap(fromIso: string, toIso: string): boolean {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return to - from >= GAP_THRESHOLD_MS;
}

/**
 * A gap, in the words that go into the notes.
 *
 * Local clock times, because that is how someone recalls a meeting — "around
 * ten past" — rather than as a duration from a start nobody remembers.
 */
export function describeGap(gap: Gap, timeZone = "Europe/London"): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));

  return `No audio ${format(gap.from)} to ${format(gap.to)}. Anything said then is missing from these notes.`;
}

/** Only the gaps worth telling someone about. */
export function reportableGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => isReportableGap(g.from, g.to));
}

// ------------------------------------------------------------ duration cap

/**
 * A meeting cannot record indefinitely without someone saying so.
 *
 * Not a technical limit but a cost one. A Tier 2 session pins an instance, and
 * a meeting nobody closed would bill for as long as the room stays open. Ninety
 * minutes covers the longest meeting anyone plans; past that, continuing is a
 * decision rather than a default.
 */
export const DURATION_CAP_MINUTES = 90;

/** Warn while there is still time to act, not at the moment it stops. */
export const EXTEND_WARNING_MINUTES = 5;

export interface CapState {
  stop: boolean;
  warn: boolean;
  minutesRemaining: number;
}

export function capState(
  startedAtIso: string,
  now: Date,
  extendedUntilIso?: string | null,
): CapState {
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) {
    // An unreadable start time must not license an unbounded recording.
    return { stop: true, warn: false, minutesRemaining: 0 };
  }

  const deadline = extendedUntilIso
    ? Date.parse(extendedUntilIso)
    : started + DURATION_CAP_MINUTES * 60_000;

  if (Number.isNaN(deadline)) return { stop: true, warn: false, minutesRemaining: 0 };

  const remainingMs = deadline - now.getTime();
  const minutesRemaining = Math.max(Math.ceil(remainingMs / 60_000), 0);

  return {
    stop: remainingMs <= 0,
    warn: remainingMs > 0 && minutesRemaining <= EXTEND_WARNING_MINUTES,
    minutesRemaining,
  };
}

// ------------------------------------------------------------- idempotency

/**
 * A stable id for one thing that was said.
 *
 * The reason this exists: after a reconnection, Meet replays transcript entries
 * that were already delivered. With a generated document id, each replay
 * becomes a second copy — and for a *commitment* that means asking someone to
 * approve the same thing twice, which is worse than a duplicated note by a wide
 * margin.
 *
 * Derived from content rather than from a sequence number, because a resumed
 * session does not continue anyone's numbering.
 *
 * Two identical utterances, from the same speaker, at the same instant, are
 * indistinguishable from one redelivered — and collapsing them is the correct
 * reading of that.
 */
export function utteranceId(at: string, speaker: string, text: string): string {
  return createHash("sha256")
    .update(`${at} ${speaker} ${text.trim()}`)
    .digest("hex")
    .slice(0, 32);
}
