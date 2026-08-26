import { z } from "zod";

/**
 * Every failure gets a route forward.
 *
 * ## The rule
 *
 * **A failure with no route is where trust is lost**, because the user's only
 * remaining move is to leave. So this file is the complete list of ways this
 * product can fail a person, and what they can do about each one.
 *
 * ## Exhaustiveness is a type error, not a test failure
 *
 * `ROUTES` is typed `Record<FailureKind, ...>`. Adding a kind without routes
 * does not compile — the build stops, in every service and in the web app at
 * once. A test would catch the same thing later and only if someone ran it.
 *
 * The test alongside it checks what types cannot: that the routes are non-empty,
 * that their ids are unique, and that every one of them says what it does in
 * words a person would use.
 *
 * ## Routes are actions, not apologies
 *
 * "Something went wrong" is not a route. Each entry here either changes the
 * situation (connect the account, upgrade, add a document) or changes what the
 * user is trying to do (continue in text, search differently). Offering a
 * "retry" that fails identically is worse than offering nothing, so retry only
 * appears where the failure is genuinely transient.
 */

export const FailureKindSchema = z.enum([
  "model_unavailable",
  "connector_not_connected",
  "plan_limit",
  "screening_blocked",
  "meet_refused",
  "retrieval_empty",
  "not_confirmed",
  "above_ceiling",
  "cost_not_acknowledged",
  "rate_limited",
  "out_of_scope",
  "upstream_error",
  "too_large",
  "not_configured",
]);

export type FailureKind = z.infer<typeof FailureKindSchema>;

/**
 * What a route does when taken.
 *
 * `retry` repeats the same thing — only ever offered where repeating could
 * plausibly work. `change` alters the request. `navigate` sends the user
 * somewhere that fixes the cause. `explain` reveals detail already held, and
 * resolves nothing on its own, which is why it is never the only route offered.
 */
export const RouteKindSchema = z.enum(["retry", "change", "navigate", "explain"]);

export const RouteSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: RouteKindSchema,
  /** Where `navigate` goes. Absent for every other kind. */
  to: z.string().optional(),
});

export type Route = z.infer<typeof RouteSchema>;

const route = (id: string, label: string, kind: Route["kind"], to?: string): Route =>
  to ? { id, label, kind, to } : { id, label, kind };

/**
 * The taxonomy.
 *
 * Every kind maps to at least two routes, deliberately: a single route is a
 * dead end wearing a button, and the second one is usually "do it another way",
 * which is the move a person actually wants when the first is not available.
 */
export const ROUTES: Record<FailureKind, Route[]> = {
  model_unavailable: [
    route("retry", "Try again", "retry"),
    route("text", "Continue in text", "change"),
    route("later", "Come back to this later", "change"),
  ],
  connector_not_connected: [
    route("connect", "Connect the account", "navigate", "/app/profile"),
    route("manual", "I'll do this one myself", "change"),
    route("skip", "Skip this step", "change"),
  ],
  plan_limit: [
    route("remaining", "See what's left this month", "navigate", "/app/profile"),
    route("upgrade", "Upgrade the plan", "navigate", "/app/profile"),
    route("wait", "Wait for the monthly reset", "change"),
  ],
  screening_blocked: [
    // Never a retry. The same content will be refused the same way, and
    // offering to try again would teach the user the block is arbitrary.
    route("why", "Why was this blocked?", "explain"),
    route("different", "Use a different source", "change"),
  ],
  meet_refused: [
    route("which", "Which tier took the notes, and why", "explain"),
    route("transcript", "Read the transcript instead", "navigate", "/app/profile"),
  ],
  retrieval_empty: [
    route("say", "Answer without documents", "change"),
    route("rephrase", "Search differently", "change"),
    route("add", "Add a document", "navigate", "/app/profile"),
  ],
  not_confirmed: [
    route("confirm", "Yes, do it", "retry"),
    route("change", "Change what it does", "change"),
    route("cancel", "Leave it", "change"),
  ],
  above_ceiling: [
    route("ceiling", "Raise what it may do on its own", "navigate", "/app/profile"),
    route("once", "Approve just this once", "retry"),
    route("cancel", "Leave it", "change"),
  ],
  cost_not_acknowledged: [
    route("cost", "Show me what this uses", "explain"),
    route("approve", "Go ahead", "retry"),
    route("cancel", "Leave it", "change"),
  ],
  rate_limited: [
    route("wait", "Wait a moment and retry", "retry"),
    route("later", "Come back to this later", "change"),
  ],
  out_of_scope: [
    route("grant", "Allow this too", "navigate", "/app/profile"),
    route("manual", "I'll do this one myself", "change"),
  ],
  upstream_error: [
    route("retry", "Try again", "retry"),
    route("later", "Come back to this later", "change"),
  ],
  too_large: [
    route("smaller", "Use a smaller file", "change"),
    route("split", "Split it and add the parts", "change"),
  ],
  not_configured: [
    // Nothing the user can fix. Saying so plainly beats a button that cannot
    // work, and the second route is the one that gets them moving again.
    route("why", "Why is this unavailable?", "explain"),
    route("skip", "Carry on without it", "change"),
  ],
};

/** The routes for a failure. Never empty — the type guarantees the key exists. */
export function routesFor(kind: FailureKind): Route[] {
  return ROUTES[kind];
}

/**
 * Map a wire error code to a failure kind.
 *
 * Returns null for codes that are not a user-facing failure — a 400 from a
 * malformed request is a bug in the client, and offering someone a recovery
 * route for it would be asking them to work around our mistake.
 */
export function failureKindFor(code: string): FailureKind | null {
  const table: Record<string, FailureKind> = {
    needs_consent: "connector_not_connected",
    no_grant: "connector_not_connected",
    out_of_scope: "out_of_scope",
    unknown_tool: "out_of_scope",
    plan_limit: "plan_limit",
    quota_exhausted: "plan_limit",
    not_confirmed: "not_confirmed",
    above_ceiling: "above_ceiling",
    cost_not_acknowledged: "cost_not_acknowledged",
    rate_limited: "rate_limited",
    blocked: "screening_blocked",
    too_large: "too_large",
    not_configured: "not_configured",
    upstream_error: "upstream_error",
    internal: "upstream_error",
  };
  return table[code] ?? null;
}

/** What was offered and what was taken. See repos/recoveries for why. */
export const RecoverySchema = z.object({
  id: z.string(),
  turnId: z.string(),
  failureKind: FailureKindSchema,
  routeOffered: z.array(z.string()),
  routeTaken: z.string().nullable(),
  at: z.string(),
});

export type Recovery = z.infer<typeof RecoverySchema>;
