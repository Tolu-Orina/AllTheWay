export * from "./recovery.js";
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

/**
 * A remembered visual preference — brand memory.
 *
 * Kept apart from LearnedPreference rather than folded into it, for a reason
 * that shows up in the interface: these are the only preferences with a
 * *visible* value. "Muted, not neon" is checkable at a glance from a swatch and
 * unfalsifiable as prose, and a user who can see the six colours it thinks they
 * like can correct it in a way they never could from a sentence.
 *
 * Reverting one is the same append-only story as the Feedback Ledger: the row
 * stays, `revertedAt` is stamped, and it stops being applied.
 */
export const VisualPreferenceSchema = z.object({
  id: z.string(),
  /** What it governs: "palette", "density", "corners", "typography". */
  aspect: z.string(),
  /** How it is phrased into a generation prompt. */
  value: z.string(),
  /**
   * Hex colours, when the aspect has any. Present for a palette, empty for
   * density — the interface shows swatches only where there is something to
   * show rather than inventing a colour to fill the space.
   */
  swatches: z.array(z.string()).default([]),
  /** What the user did that taught it this. Never inferred prose. */
  evidence: z.string(),
  revertedAt: z.string().datetime().nullable(),
});

/**
 * A meeting, and which tier served it.
 *
 * `tier` and `explanation` are both stored rather than derived, because the
 * question a user asks afterwards is "why were there no live notes" — and an
 * explanation recomputed later against changed code would silently rewrite the
 * history of a meeting that already happened.
 */
export const MeetingSchema = z.object({
  id: z.string(),
  spaceName: z.string(),
  conferenceId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** 2 = listened live, 1 = read the transcript after, 0 = neither. */
  tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Verbatim refusal from the preview programme. Never mapped to a code. */
  tierReason: z.string(),
  explanation: z.string(),
  participants: z.array(z.string()),
  status: z.enum(["listening", "processing", "ready", "blocked"]),
  /**
   * The most recent health sample, when one exists.
   *
   * Optional because a Tier 1 meeting has no live connection to measure — and
   * showing a connection indicator for a transcript read afterwards would be
   * describing something that never happened.
   */
  health: z
    .object({
      at: z.string(),
      rtt: z.number(),
      jitter: z.number(),
      packetLoss: z.number(),
      reconnects: z.number(),
      streamGaps: z.number(),
    })
    .nullable()
    .default(null),
});

/**
 * Something someone may have committed to.
 *
 * FR-C2: a proposal, never a record of something done. `confirmed` is the only
 * thing that distinguishes "we think this was said" from "you agreed we should
 * act", and nothing may act on the first.
 */
export const CommitmentSchema = z.object({
  id: z.string(),
  at: z.string(),
  /** "Unattributed" when three audio streams could not separate the voices. */
  speakerLabel: z.string(),
  text: z.string(),
  confirmed: z.boolean(),
});

/**
 * A share: one person, one artifact, one role.
 *
 * There is no public link, deliberately. A URL that works for whoever holds it
 * is a different security model from the rest of this product — it cannot be
 * revoked from the person who forwarded it, and it cannot say who read it.
 */
export const ShareSchema = z.object({
  granteeUid: z.string(),
  granteeEmail: z.string(),
  /** `viewer` can read; `commenter` can also comment. Neither can edit. */
  role: z.enum(["viewer", "commenter"]),
  grantedBy: z.string(),
  grantedAt: z.string(),
  /** Set when revoked. The row stays, so the history of access is intact. */
  revokedAt: z.string().nullable(),
});

/**
 * A comment, anchored to the version it was written about.
 *
 * `versionAnchor` is the whole point. A comment on v2 that silently reattached
 * to v5 would appear to be about text nobody wrote — the reader sees a remark
 * that does not match what is in front of them and concludes the commenter was
 * careless, when in fact the document moved underneath them.
 */
export const CommentSchema = z.object({
  id: z.string(),
  authorUid: z.string(),
  authorEmail: z.string(),
  versionAnchor: z.number().int().positive(),
  body: z.string(),
  resolved: z.boolean(),
  resolvedBy: z.string().nullable(),
  at: z.string(),
});

/** An artifact someone else shared with this user. */
export const SharedArtifactSchema = z.object({
  artifactId: z.string(),
  ownerUid: z.string(),
  ownerEmail: z.string(),
  title: z.string(),
  role: z.enum(["viewer", "commenter"]),
  sharedAt: z.string(),
});

/**
 * The morning digest: what happened while you were away.
 *
 * Computed on read rather than stored, so its counts cannot disagree with the
 * ledger — a digest that disagrees with the record is worse than none.
 */
export const DigestSchema = z.object({
  date: z.string(),
  ranWatchers: z.array(
    z.object({ watcherId: z.string(), at: z.string(), summary: z.string() }),
  ),
  /** The actionable half: things still waiting for a person. */
  awaitingDecision: z.array(
    z.object({ id: z.string(), summary: z.string(), at: z.string() }),
  ),
  artifactsChanged: z.array(
    z.object({ id: z.string(), title: z.string(), at: z.string() }),
  ),
  sentAt: z.string().nullable(),
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
export type VisualPreference = z.infer<typeof VisualPreferenceSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Share = z.infer<typeof ShareSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type SharedArtifact = z.infer<typeof SharedArtifactSchema>;
export type Digest = z.infer<typeof DigestSchema>;
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

/* ------------------------------------------------------------------ *
 * Artifacts (v3 Phase A)
 *
 * The durable, versioned thing the agent produced — a document, a
 * wireframe, a summary. The noun the product was missing: plans and
 * traces describe work, but they are not deliverables, and nothing
 * before this could be corrected and kept.
 *
 * Shared here because the gateway writes these and the web app renders
 * them, and a field renamed on one side must not quietly keep working
 * on the other.
 * ------------------------------------------------------------------ */

export const ArtifactKindSchema = z.enum([
  "doc",
  "image",
  "video",
  "summary",
  "checklist",
]);

/** Who made a version. `agent` and `user` are not interchangeable: the
 *  Feedback Ledger's value is knowing which corrections were human. */
export const ProducedBySchema = z.enum(["user", "agent"]);

/**
 * Where an artifact came from, carried per artifact rather than per
 * version because it identifies the *contract* that produced it.
 *
 * `cardVersion` is the AgentCard version, not the build SHA — the card
 * is the published contract a caller relied on, which is what Phase 7's
 * attribution requirement actually asks for.
 */
export const ProvenanceSchema = z.object({
  agentId: z.string(),
  cardVersion: z.string(),
  model: z.string().default(""),
  sources: z.array(z.string()).default([]),
});

export const ArtifactVersionSchema = z.object({
  /** Monotonic from 1. Also the document id, so ordering needs no index. */
  n: z.number().int().positive(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  producedBy: ProducedBySchema,
  /** What was asked for. Empty for a direct user edit. */
  prompt: z.string().default(""),
  /** What the user said was wrong with n-1. This is the learning signal. */
  correction: z.string().default(""),
  /** null only for n = 1. */
  supersedes: z.number().int().positive().nullable(),
});

export const ArtifactSchema = z.object({
  id: z.string(),
  kind: ArtifactKindSchema,
  title: z.string(),
  /** The session it was made in, so the canvas can be reopened in context. */
  sessionId: z.string().default(""),
  currentVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  provenance: ProvenanceSchema,
});

/** An artifact with its history, for the canvas. */
export const ArtifactDetailSchema = ArtifactSchema.extend({
  versions: z.array(ArtifactVersionSchema),
});

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;
