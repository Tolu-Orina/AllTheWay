import { z } from "zod";

/**
 * Live insights during a meeting.
 *
 * ## What this is not
 *
 * Not a rolling summary. Nobody reads a summary of a meeting they are currently
 * in — they were there. Summaries earn their place afterwards, which the notes
 * already do.
 *
 * What is worth interrupting for is the thing a person in the room *cannot*
 * know: that the number just quoted disagrees with their own contract, or that
 * a question went unanswered four minutes ago. That is the bar each insight has
 * to clear.
 *
 * ## Cited or absent
 *
 * Every insight names where it came from — a document and page, or a web source.
 * An uncited assertion during a live negotiation is precisely the confident,
 * fluent, wrong claim the grounding work exists to prevent, and it is worse here
 * than anywhere else because someone may act on it within the minute.
 */

export const InsightKindSchema = z.enum([
  /** Something said disagrees with the user's own documents. */
  "contradiction",
  /** A fact from the user's documents or the web that bears on what was said. */
  "context",
  /** A question that was asked and never answered. */
  "unanswered",
]);

export const InsightSourceSchema = z.object({
  /** "document" for the user's own corpus, "web" for a search result. */
  kind: z.enum(["document", "web"]),
  title: z.string(),
  /** Page for a document, URL for the web. */
  locator: z.string(),
});

export const InsightSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: InsightKindSchema,
  /** One sentence. A paragraph will not be read mid-meeting. */
  text: z.string(),
  sources: z.array(InsightSourceSchema),
});

export type Insight = z.infer<typeof InsightSchema>;
export type InsightKind = z.infer<typeof InsightKindSchema>;

/**
 * When to look, measured in minutes from the start of the meeting.
 *
 * ## Why the gaps widen
 *
 * The first minutes of a meeting establish what it is about, and context
 * arrives faster than it will again — so early passes are worth their cost. An
 * hour in, the ground has stopped shifting and a pass every minute would be
 * paying repeatedly to learn the same thing.
 *
 * It also matters for attention. A panel that updates constantly competes with
 * the meeting, and anything pulling a person's eye has to be worth more than
 * the sentence they will miss reading it. Frequent early, then quiet, is how a
 * person actually wants to be helped.
 *
 * ## And for cost
 *
 * A ninety-minute meeting at a fixed one-minute cadence is ninety reasoning
 * passes over a growing window. This schedule is ten.
 */
export const INSIGHT_MARKS_MINUTES = [1, 3, 5, 10, 15] as const;

/** After the last explicit mark, insights settle to this interval. */
export const INSIGHT_STEADY_INTERVAL_MINUTES = 15;

/**
 * The next moment worth looking, given how far in we are.
 *
 * Returns minutes-from-start. Pure so the schedule can be asserted rather than
 * observed in production, and shared so the interface can honestly say "next
 * look in about four minutes" instead of guessing.
 */
export function nextInsightAt(elapsedMinutes: number): number {
  for (const mark of INSIGHT_MARKS_MINUTES) {
    if (elapsedMinutes < mark) return mark;
  }

  const last = INSIGHT_MARKS_MINUTES[INSIGHT_MARKS_MINUTES.length - 1];
  const stepsPast = Math.floor((elapsedMinutes - last) / INSIGHT_STEADY_INTERVAL_MINUTES) + 1;
  return last + stepsPast * INSIGHT_STEADY_INTERVAL_MINUTES;
}

/** Whether a pass is due, given when the last one ran. */
export function insightDue(elapsedMinutes: number, lastRunMinutes: number | null): boolean {
  // The first mark has not been reached yet.
  if (lastRunMinutes === null) return elapsedMinutes >= INSIGHT_MARKS_MINUTES[0];
  return elapsedMinutes >= nextInsightAt(lastRunMinutes);
}

/**
 * Every scheduled pass in a meeting of this length. For cost arithmetic and for
 * the tests that keep the schedule honest.
 */
export function insightSchedule(meetingMinutes: number): number[] {
  const marks: number[] = [];
  let at = 0;
  while (true) {
    at = nextInsightAt(at);
    if (at > meetingMinutes) break;
    marks.push(at);
  }
  return marks;
}
