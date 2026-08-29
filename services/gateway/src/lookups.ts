import { runReadTool, type ToolResult } from "./voice/tools.js";

/**
 * Live reads from the user's connected accounts, for a *typed* turn.
 *
 * Voice already has these as tools the live model can call. Text turns went
 * through the planner with no fetch at all — the prompt even told it to leave
 * connector empty for a read — so "what's on today" could only ever be
 * answered from the words in the box. Same user, same grants, same tools;
 * the planner just never got the results.
 *
 * Fetched here, not by the orchestrator: that service is stateless and cannot
 * hold a connector grant. Handed over as labelled untrusted context, the same
 * channel passages use.
 *
 * ## Only the tools the utterance is asking for
 *
 * Prefetching calendar, Drive, digest and meetings on every "draft a nav"
 * would make every turn wait on four backends. The budget below is a ceiling
 * for the ones we *do* run, so a hung connector cannot stall the planner.
 */

const LOOKUP_BUDGET_MS = 6_000;

export type ReadCall = { name: string; args: Record<string, unknown> };

const CALENDAR =
  /\b(calendar|schedule|timetable|agenda|free|busy|what'?s on|what have i got|later today|this (morning|afternoon|evening|week)|tomorrow|remind(er|ers| me)|events?)\b/i;
const ABOUT_THE_DAY =
  /\b(today|tonight|tomorrow|this (morning|afternoon|evening|week)|scheduled)\b/i;
const MEETING_SLOT = /\b(meetings?|appointments?)\b/i;
const DAY_WINDOW =
  /\b(today|tonight|this (morning|afternoon|evening)|did i have|have i got)\b/i;
const LATER_ONLY = /\b(later today|upcoming|what's next|whats next)\b/i;
const DRIVE =
  /\b(drive|google drive|google docs|my files|find (the |a )?(file|doc|document|folder|spreadsheet|slide)|save (this |it |the )?(notes?|file|doc)? ?to (my )?drive|send (this |it |the )?(notes?|file|doc)? ?to (my )?drive|notes? to (my )?drive)\b/i;
const WAITING =
  /\b(waiting( on me)?|needs? me|overnight|anything waiting|what happened|digest|catch me up)\b/i;
const MEETINGS =
  /\b(what (did we|was) agree|meeting notes|last meeting|what we (said|agreed)|commitments?)\b/i;
const GMAIL =
  /\b(gmail|e-?mails?|inbox|send (this |it |a )?(mail|message|e-?mail)|create (a )?(mail |e-?mail )?draft|save (a )?draft|e-?mail (this|it|them|me)|mail (this|it) to)\b/i;

function wantsCalendar(text: string): boolean {
  if (CALENDAR.test(text)) return true;
  // "Did I have any meeting today?" is a calendar question. "What did we agree
  // in the last meeting?" is notes, and must not steal the calendar read.
  if (MEETINGS.test(text)) return false;
  return MEETING_SLOT.test(text) && ABOUT_THE_DAY.test(text);
}

function wantsDayWindow(text: string): boolean {
  return DAY_WINDOW.test(text) && !LATER_ONLY.test(text);
}

/** Start of the UTC day. Good enough until we store a timezone. */
export function startOfUtcDay(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Which read tools this utterance is asking for.
 *
 * Exported so the mapping can be tested without a connector. A write
 * ("schedule lunch") still matches calendar — listing what's already there
 * is useful context for the plan — but the planner still has to name the
 * write and stop at confirm.
 */
export function selectReadTools(message: string): ReadCall[] {
  const text = message.trim();
  if (!text) return [];
  const out: ReadCall[] = [];
  if (wantsCalendar(text)) {
    const args: Record<string, unknown> = { limit: 10 };
    if (wantsDayWindow(text)) args.time_min = startOfUtcDay();
    out.push({ name: "whats_on_my_calendar", args });
  }
  if (DRIVE.test(text)) out.push({ name: "find_in_my_drive", args: { limit: 10 } });
  if (GMAIL.test(text)) out.push({ name: "gmail_account", args: {} });
  if (WAITING.test(text)) out.push({ name: "whats_waiting_for_me", args: {} });
  if (MEETINGS.test(text)) out.push({ name: "my_recent_meetings", args: { limit: 5 } });
  return out;
}

function asLine(name: string, result: ToolResult): string | null {
  if (result.cannot) return `${name}: ${String(result.cannot)}`;
  const rest = { ...result };
  delete rest.cannot;
  const body = JSON.stringify(rest);
  if (!body || body === "{}") return null;
  return `${name}: ${body.slice(0, 3500)}`;
}

function withBudget<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), LOOKUP_BUDGET_MS)),
  ]);
}

/**
 * Run the matching read tools and return lines the planner can quote.
 *
 * Never throws. An empty list means "nothing extra to say", which is also
 * what a user with no connections should see — the planner then answers from
 * the conversation, the same as before this existed.
 */
export async function connectedLookups(uid: string, message: string): Promise<string[]> {
  const calls = selectReadTools(message);
  if (!calls.length) return [];

  const lines = await Promise.all(
    calls.map(async (call) => {
      const result = await withBudget(runReadTool(uid, call.name, call.args), {
        cannot: "I could not reach that just now.",
      });
      return asLine(call.name, result);
    }),
  );
  return lines.filter((line): line is string => Boolean(line));
}
