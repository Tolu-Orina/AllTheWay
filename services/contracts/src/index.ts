import { z } from "zod";

/**
 * The wire contract between the web client and the gateway.
 *
 * One definition, imported by both sides, so a field cannot be renamed on the
 * server and quietly keep working on the client. Every gateway response is
 * parsed through these schemas before it is returned, and the client types are
 * inferred from them rather than written twice.
 */

export const PlanStepSchema = z.object({
  label: z.string(),
  done: z.boolean(),
  /**
   * What this step would change outside the conversation, if anything.
   * Empty means it changes nothing. A non-empty value is what makes the
   * confirm gate stop the turn (FR-V2), and what lets the UI say plainly that
   * a step will send, pay, or delete before anyone approves it.
   */
  action: z.string().default(""),
});

/** One step the user is being asked to approve, and why it needs approving. */
export const ProposedActionSchema = z.object({
  label: z.string(),
  action: z.string(),
  reason: z.string(),
});

/**
 * One thing becoming known during a turn.
 *
 * The orchestrator streams these as it works, and the gateway relays them to
 * the browser as SSE. Every event is final: a step that has arrived is never
 * retracted or reworded, so a plan panel can append rather than reconcile.
 *
 * There is deliberately no "decision" event. The verdict is implied by which
 * terminal event lands -- `clarify`, or steps followed by `done` -- because
 * announcing a decision early would mean occasionally taking it back when a
 * plan turns out to be empty.
 */
export const TurnEventSchema = z.discriminatedUnion("kind", [
  /** Why the agent is doing what it is doing, as it happens. */
  z.object({ kind: z.literal("trace"), text: z.string() }),
  /** One plan step, complete. */
  z.object({ kind: z.literal("step"), step: PlanStepSchema }),
  /** The Clarify Gate stopped the turn. No plan follows this. */
  z.object({
    kind: z.literal("clarify"),
    question: z.string(),
    options: z.array(z.string()).default([]),
  }),
  /**
   * The plan is ready and will not run until the user agrees (FR-V2).
   *
   * Terminal for the turn, like `clarify`, and the same protocol state
   * underneath — but a different thing to say to a person. `clarify` means "I
   * do not understand you"; this means "I understand you, and I am not doing
   * that without a yes".
   */
  z.object({
    kind: z.literal("confirm"),
    /** Plain language, meant to be spoken aloud as well as shown. */
    summary: z.string(),
    options: z.array(z.string()).default([]),
    actions: z.array(ProposedActionSchema).default([]),
  }),
  /** The plan is finished. */
  z.object({ kind: z.literal("done"), note: z.string().default("") }),
  /**
   * The turn failed. Carried in-band rather than as an HTTP status, because by
   * the time it happens the response has already begun with a 200.
   */
  z.object({ kind: z.literal("error"), message: z.string() }),
]);

export type TurnEvent = z.infer<typeof TurnEventSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ISO-8601. Formatting to "12 minutes ago" is a client concern. */
  updatedAt: z.string().datetime(),
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

export const CorrectionSchema = z.object({
  was: z.string(),
  now: z.string(),
});

export const SessionDetailSchema = SessionSchema.extend({
  scope: z.string(),
  plan: z.array(PlanStepSchema),
  correction: CorrectionSchema.nullable(),
  companionNote: z.string(),
});

/**
 * How much a watcher may do unsupervised. The floor for irreversible actions is
 * enforced server-side regardless of this value — see the manifest, FR-W4.
 */
export const CeilingSchema = z.enum([
  "draft_only",
  "send_after_review",
  "send_automatically",
]);

export const WatcherSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  ceiling: CeilingSchema,
  running: z.boolean(),
  lastRunAt: z.string().datetime().nullable(),
});

export const WatcherRunSchema = z.object({
  id: z.string(),
  watcherId: z.string(),
  name: z.string(),
  detail: z.string(),
  /**
   * "blocked" is distinct from "failed": nothing broke, and the run did exactly
   * what it should. It is also distinct from "awaiting_review" — there is
   * nothing here for a user to approve.
   */
  state: z.enum(["awaiting_review", "done", "failed", "blocked"]),
  /**
   * What happened, in order. This is where a screened-out injection becomes
   * visible rather than merely prevented — a block nobody can see is nearly as
   * bad as no block. Never contains screened content itself.
   */
  trace: z.array(z.string()).default([]),
  at: z.string().datetime(),
});

export const LearnedPreferenceSchema = z.object({
  id: z.string(),
  area: z.string(),
  was: z.string(),
  now: z.string(),
  evidence: z.string(),
  revertedAt: z.string().datetime().nullable(),
});

/** Errors carry a stable code the client can branch on, plus prose for a human. */
export const ApiErrorSchema = z.object({
  code: z.enum([
    "unauthenticated",
    "forbidden",
    "not_found",
    "invalid_request",
    "rate_limited",
    "internal",
  ]),
  message: z.string(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type Ceiling = z.infer<typeof CeilingSchema>;
export type Watcher = z.infer<typeof WatcherSchema>;
export type WatcherRun = z.infer<typeof WatcherRunSchema>;
export type LearnedPreference = z.infer<typeof LearnedPreferenceSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Human-facing labels live with the enum so both sides agree on wording. */
export const CEILING_LABELS: Record<Ceiling, string> = {
  draft_only: "Draft only",
  send_after_review: "Send after review",
  send_automatically: "Send automatically",
};

export const RUN_STATE_LABELS: Record<WatcherRun["state"], string> = {
  awaiting_review: "Awaiting review",
  done: "Done",
  failed: "Failed",
  blocked: "Blocked",
};

/** Request bodies. */
export const ToggleWatcherSchema = z.object({ running: z.boolean() });
export const RevertPreferenceSchema = z.object({ id: z.string() });
