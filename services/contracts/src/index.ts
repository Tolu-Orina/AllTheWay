export * from "./i18n.js";
export * from "./insights.js";
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
  done: z.boolean().default(false),
  /**
   * What this step would change outside the conversation, if anything.
   * Empty means it changes nothing. A non-empty value is what makes the
   * confirm gate stop the turn (FR-V2), and what lets the UI say plainly that
   * a step will send, pay, or delete before anyone approves it.
   */
  action: z.string().default(""),

  /**
   * The call this step would make, when it makes one.
   *
   * The planner named a step's *severity* and nothing else, so a confirmed plan
   * had nothing to replay: "Yes" wrote a ledger row and the calendar stayed
   * empty. These three carry the call itself, so the gateway acts on exactly
   * what the person was shown and approved -- not on a re-derivation of it.
   *
   * Empty for a step that changes nothing. `arguments` is deliberately untyped:
   * each connector validates its own, and restating those shapes here would
   * mean two places to be wrong.
   */
  connector: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/** One step the user is being asked to approve, and why it needs approving. */
export const ProposedActionSchema = z.object({
  label: z.string(),
  action: z.string(),
  reason: z.string(),
  /** The call, mirroring PlanStep. Empty when this proposes no call. */
  connector: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Where a claim came from, as a field, never inferred from prose.
 *
 * `text` is the passage that was in the prompt (FR-D2). The chip opens this
 * string — it does not re-query, and it does not carry a uid. Path-scoped
 * retrieval already happened on the gateway.
 */
export const CitationSchema = z.object({
  documentId: z.string(),
  chunkId: z.string(),
  page: z.number().int(),
  title: z.string(),
  text: z.string(),
});

export type Citation = z.infer<typeof CitationSchema>;

/**
 * A document-derived answer that claims to be grounded must cite.
 *
 * The live `done` event allows empty citations — an ordinary chat turn is not
 * grounded, and must not fail the schema. This fixture is the control: a
 * turn that says it is grounded and cites nothing is not a valid contract.
 */
export const GroundedDoneSchema = z.object({
  kind: z.literal("done"),
  note: z.string(),
  grounded: z.literal(true),
  citations: z.array(CitationSchema).min(1),
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
  /**
   * A retrieved passage this turn actually used. The chip opens `text`;
   * nothing is fetched from another user.
   */
  CitationSchema.extend({ kind: z.literal("citation") }),
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
  z.object({
    kind: z.literal("done"),
    note: z.string().default(""),
    citations: z.array(CitationSchema).default([]),
  }),
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
  /**
   * Work threads, companion chats, and spoken sessions are different lists.
   *
   * Absent on rows written before this field existed — those are work, except
   * the legacy id `"companion"`. Voice is its own surface so a typed chat does
   * not reopen inside the live overlay.
   */
  surface: z.enum(["work", "companion", "voice"]).default("work"),
});

/**
 * Work / home / church. One companion, optional scope on a memory row.
 * `null` means the fact applies everywhere — today's behaviour, and the
 * default until a correction is made while Today is filtered.
 */
export const HatSchema = z.enum(["work", "home", "church"]);

export const CorrectionSchema = z.object({
  was: z.string(),
  now: z.string(),
  /** Absent or null: the fact applies under every hat. */
  hat: HatSchema.nullable().optional(),
});

/**
 * One bubble in a persisted companion thread.
 *
 * `id` is assigned by the client for React keys and is not meaningful across
 * devices. `at` is when it was stored, so a reload can reconstruct order even if
 * two writes land in the same second.
 */
export const ThreadMessageSchema = z.object({
  role: z.enum(["agent", "user"]),
  text: z.string(),
  at: z.string().datetime(),
  phase: z.enum(["clarify", "confirm", "done", "error"]).optional(),
  options: z.array(z.string()).optional(),
  actions: z.array(ProposedActionSchema).optional(),
  citations: z.array(CitationSchema).optional(),
  steps: z.array(PlanStepSchema).optional(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const SessionDetailSchema = SessionSchema.extend({
  scope: z.string(),
  plan: z.array(PlanStepSchema),
  correction: CorrectionSchema.nullable(),
  companionNote: z.string(),
  /**
   * The conversation on this session, oldest first.
   *
   * Companion chat used to live only in React state, so a reload (or a phone
   * that backgrounded the tab) forgot every word. Voice transcripts stay a
   * separate opt-in; this is the typed thread, and it is persisted because
   * the person asked us to remember it.
   */
  thread: z.array(ThreadMessageSchema).default([]),
});

/**
 * What the person said they were here to do. Null on GET means they have not
 * been asked yet — that is the first-run screen, not a missing row to 404.
 */
export const OnboardingJobSchema = z.enum(["talk", "document", "meetings", "skipped"]);
export const LifeContextSchema = z.enum(["work", "personal", "both"]);
export const OnboardingSchema = z.object({
  job: OnboardingJobSchema.nullable(),
  lifeContext: LifeContextSchema.nullable(),
});

export type OnboardingJob = z.infer<typeof OnboardingJobSchema>;
export type LifeContext = z.infer<typeof LifeContextSchema>;
export type Onboarding = z.infer<typeof OnboardingSchema>;

/**
 * How much a watcher may do unsupervised. The floor for irreversible actions is
 * enforced server-side regardless of this value — see the manifest, FR-W4.
 */
export const CeilingSchema = z.enum([
  "draft_only",
  "send_after_review",
  "send_automatically",
]);

export const WatcherTriggerKindSchema = z.enum([
  "schedule",
  "session_ended",
  "document_indexed",
]);

export const WatcherSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  ceiling: CeilingSchema,
  running: z.boolean(),
  lastRunAt: z.string().datetime().nullable(),
  instruction: z.string().default(""),
  triggerKind: WatcherTriggerKindSchema.default("schedule"),
  intervalMinutes: z.number().int().positive().nullable().default(null),
});

/**
 * A standing instruction. intervalMinutes is required for schedule and ignored
 * for session_ended. The server refuses anything under 60 minutes.
 */
export const CreateWatcherSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    instruction: z.string().trim().min(1).max(2000),
    triggerKind: WatcherTriggerKindSchema,
    intervalMinutes: z.number().int().min(60).max(10_080).optional(),
    ceiling: CeilingSchema.default("send_after_review"),
  })
  .superRefine((value, ctx) => {
    if (value.triggerKind === "schedule" && value.intervalMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A schedule needs an interval.",
        path: ["intervalMinutes"],
      });
    }
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
  /** Work item this run produced, if any. Empty until something was kept. */
  sessionId: z.string().default(""),
});

export const LearnedPreferenceSchema = z.object({
  id: z.string(),
  area: z.string(),
  was: z.string(),
  now: z.string(),
  evidence: z.string(),
  revertedAt: z.string().datetime().nullable(),
  /** Absent or null: applies under every hat. */
  hat: HatSchema.nullable().optional(),
  source: z.enum(["session", "synth"]).optional(),
  /**
   * Sleep-time proposals only. A human correction has no score: it happened.
   * Below the activation bar the row is `proposed` and is not injected.
   */
  confidence: z.number().min(0).max(1).optional(),
  proposed: z.boolean().optional().default(false),
});

/**
 * What this person finds hard, per concept. Not a prompt instruction.
 *
 * Written only when they ask to hear a cited passage again, or miss a
 * check. Never from how long they looked.
 */
export const ConceptSchema = z.object({
  id: z.string(),
  label: z.string(),
  documentId: z.string(),
  encountered: z.number().int().nonnegative(),
  reasked: z.number().int().nonnegative(),
  reexplained: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  lastSeenAt: z.string().datetime(),
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
  /**
   * Tier 1.5: captured by the browser extension on the user's own machine.
   *
   * Distinct from the tier ladder rather than folded into it. Tier 0 means
   * "nothing could serve this"; local capture means "the user served it
   * themselves", and showing the first for the second would report a failure
   * where none happened.
   */
  capturedLocally: z.boolean().default(false),
  optedOut: z.boolean().default(false),
  bot: z
    .object({
      disclosed: z.boolean().default(false),
      confirmedBy: z.string().optional().default(""),
      confirmedAt: z.string().optional().default(""),
      status: z.enum([
        "idle",
        "knocking",
        "admitted",
        "not_admitted",
        "recording",
        "ended",
        "vendor_pending",
      ]),
      meetUrl: z.string().default(""),
      displayName: z.string().default(""),
      reason: z.string().default(""),
    })
    .nullable()
    .optional()
    .default(null),
  /**
   * Snapshot of the duration cap at list time. Shown so a long call can be
   * extended while there is still time, not after recording has already stopped.
   */
  duration: z
    .object({
      minutesRemaining: z.number(),
      warn: z.boolean(),
      stop: z.boolean(),
    })
    .nullable()
    .default(null),
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
    z.object({
      id: z.string(),
      summary: z.string(),
      at: z.string(),
      /** When present, the digest links to this work item rather than the list. */
      sessionId: z.string().default(""),
    }),
  ),
  artifactsChanged: z.array(
    z.object({ id: z.string(), title: z.string(), at: z.string() }),
  ),
  sentAt: z.string().nullable(),
});

export const ActOutcomeSchema = z.object({
  label: z.string(),
  connector: z.string(),
  tool: z.string(),
  /** "done", "refused", "skipped", or "failed". */
  did: z.string(),
  detail: z.string(),
});

export const DecisionResultSchema = z.object({
  id: z.string(),
  did: z.array(ActOutcomeSchema).default([]),
});
export const ApiErrorSchema = z.object({
  /**
   * Codes the gateway actually returns. A document 422 used to send `blocked`
   * and the client dropped the message because this enum did not include it —
   * which is how "there was no readable text" became "Something went wrong."
   */
  code: z.enum([
    "unauthenticated",
    "forbidden",
    "not_found",
    "invalid_request",
    "rate_limited",
    "internal",
    "blocked",
    "too_large",
    "plan_limit",
    "upstream_error",
    "not_configured",
    "not_self_serve",
  ]),
  message: z.string(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type ActOutcome = z.infer<typeof ActOutcomeSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type Ceiling = z.infer<typeof CeilingSchema>;
export type Watcher = z.infer<typeof WatcherSchema>;
export type WatcherTriggerKind = z.infer<typeof WatcherTriggerKindSchema>;
export type CreateWatcher = z.infer<typeof CreateWatcherSchema>;
export type WatcherRun = z.infer<typeof WatcherRunSchema>;
export type LearnedPreference = z.infer<typeof LearnedPreferenceSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type VisualPreference = z.infer<typeof VisualPreferenceSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Share = z.infer<typeof ShareSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type SharedArtifact = z.infer<typeof SharedArtifactSchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * One round trip for Today. Home used to wait on onboarding, then fire four
 * more requests (including a list-then-detail for the continue card).
 */
export const HomeDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string().optional().default(""),
  pages: z.number().optional().default(0),
  chunks: z.number().optional().default(0),
  status: z.enum(["screening", "indexing", "ready", "blocked"]),
  blockedReason: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  /** Absent or null: unlabeled. Retrieval must not infer a hat from the title. */
  hat: HatSchema.nullable().optional(),
});

/**
 * Life on Today: the next twelve hours, leave-now, and capture.
 *
 * Hats are filters over one companion, not three products. Google Calendar
 * remains the clock; these objects are anticipation — who, where, when to leave.
 */

export const DayItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  hat: HatSchema,
  source: z.enum(["calendar", "rhythm"]),
  personName: z.string().default(""),
  leaveAt: z.string().nullable(),
  placeLabel: z.string().default(""),
  /** Google Meet URL when the calendar event has one. Empty otherwise. */
  meetUrl: z.string().default(""),
});

export const NextLeaveSchema = z.object({
  title: z.string(),
  leaveAt: z.string(),
  minutes: z.number(),
});

export const DaySchema = z.object({
  calendar: z.enum(["connected", "missing", "error"]),
  hours: z.array(DayItemSchema),
  nextLeave: NextLeaveSchema.nullable(),
});

export const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  relation: z.string().default(""),
});

export const PlaceSchema = z.object({
  id: z.string(),
  label: z.string(),
  bufferMinutes: z.number().int().min(0).max(180).default(15),
  hat: HatSchema.default("home"),
});

export const RhythmSchema = z.object({
  id: z.string(),
  title: z.string(),
  hat: HatSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  time: z.string(),
  timeZone: z.string().default("Europe/London"),
  personId: z.string().default(""),
  placeId: z.string().default(""),
});

export const ReminderSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["leave", "start", "prepare"]),
  fireAt: z.string(),
  state: z.enum(["scheduled", "fired", "dismissed"]),
  hat: HatSchema.default("home"),
  rhythmId: z.string().default(""),
  commitmentId: z.string().default(""),
  repeat: z
    .enum(["once", "daily", "weekly", "biweekly", "bimonthly", "monthly", "yearly"])
    .default("once"),
});

export const TaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable().default(null),
  hat: HatSchema.nullable().default(null),
});

export const ProposedCommitmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string().nullable(),
  hat: HatSchema.default("home"),
  sourceDocumentId: z.string().default(""),
  sourceTitle: z.string().default(""),
  state: z.enum(["proposed", "accepted", "declined"]),
  detail: z.string().default(""),
});

export const HomeSchema = z.object({
  onboarding: OnboardingSchema,
  plan: SessionDetailSchema.nullable(),
  digest: DigestSchema,
  runs: z.array(WatcherRunSchema),
  documents: z.array(HomeDocumentSchema),
  day: DaySchema,
  reminders: z.array(ReminderSchema),
  proposed: z.array(ProposedCommitmentSchema),
  people: z.array(PersonSchema),
  places: z.array(PlaceSchema),
  rhythms: z.array(RhythmSchema),
  /** Today's hat filter. null is All — inject and retrieve without a hat cut. */
  hat: HatSchema.nullable(),
});

export type HomeDocument = z.infer<typeof HomeDocumentSchema>;
export type Home = z.infer<typeof HomeSchema>;
export type Hat = z.infer<typeof HatSchema>;
export type DayItem = z.infer<typeof DayItemSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Rhythm = z.infer<typeof RhythmSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type ProposedCommitment = z.infer<typeof ProposedCommitmentSchema>;

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
export const AcceptPreferenceSchema = z.object({ id: z.string() });
export const SetHatSchema = z.object({
  hat: HatSchema.nullable(),
});
export const ConceptEventSchema = z.object({
  documentId: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
});
export const RevertConceptSchema = z.object({ id: z.string() });

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
  /** Latest version's MIME, so the rail can say PowerPoint without opening it. */
  mimeType: z.string().optional().default(""),
});

/** An artifact with its history, for the canvas. */
export const ArtifactDetailSchema = ArtifactSchema.extend({
  versions: z.array(ArtifactVersionSchema),
});

export const MIME_WORD =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_SHEET =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MIME_SLIDES =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function isOfficeMime(mimeType: string): boolean {
  return mimeType === MIME_WORD || mimeType === MIME_SHEET || mimeType === MIME_SLIDES;
}

export function isTextEditableMime(mimeType: string): boolean {
  if (!mimeType) return true;
  if (isOfficeMime(mimeType)) return false;
  if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) return false;
  if (mimeType === "application/pdf") return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  );
}

export function extensionForMime(mimeType: string): string {
  if (mimeType === MIME_WORD) return ".docx";
  if (mimeType === MIME_SHEET) return ".xlsx";
  if (mimeType === MIME_SLIDES) return ".pptx";
  if (mimeType === "text/markdown") return ".md";
  if (mimeType === "text/plain") return ".txt";
  if (mimeType === "text/csv") return ".csv";
  if (mimeType === "application/json") return ".json";
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType.startsWith("image/png")) return ".png";
  if (mimeType.startsWith("image/jpeg")) return ".jpg";
  if (mimeType.startsWith("image/webp")) return ".webp";
  if (mimeType.startsWith("video/mp4")) return ".mp4";
  if (mimeType.startsWith("video/webm")) return ".webm";
  return "";
}

export function officeKindLabel(mimeType: string): "word" | "sheet" | "slides" | "doc" | "image" | "video" {
  if (mimeType === MIME_WORD) return "word";
  if (mimeType === MIME_SHEET) return "sheet";
  if (mimeType === MIME_SLIDES) return "slides";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "doc";
}

/**
 * What to show when opening an artifact, without pretending every MIME type
 * is a live Word/Excel/PowerPoint editor.
 *
 * Text stays editable. Office Open XML is previewed as structure (paragraphs,
 * sheet rows, slide bullets) and downloaded as the real file.
 */
export const ArtifactPreviewSchema = z.object({
  mimeType: z.string(),
  format: z.enum(["text", "image", "video", "word", "sheet", "slides", "binary"]),
  text: z.string().optional(),
  paragraphs: z.array(z.string()).optional(),
  sheets: z
    .array(
      z.object({
        name: z.string(),
        rows: z.array(z.array(z.string())),
      }),
    )
    .optional(),
  slides: z
    .array(
      z.object({
        title: z.string(),
        bullets: z.array(z.string()),
        /** data: URL of a still on that page, when the PPT embeds one. */
        image: z.string().optional(),
      }),
    )
    .optional(),
});

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;
export type ArtifactPreview = z.infer<typeof ArtifactPreviewSchema>;

/* ------------------------------------------------------------------ *
 * Usage and plan
 *
 * Here, not in the gateway or the client, because both read it and the
 * two had already drifted: the web app hardcoded three of the seven
 * meters and three of the four tiers, so a `meeting_insights` row failed
 * validation and the whole usage panel rendered as "We could not load
 * this" — and a Max subscriber's usage could not parse at all.
 *
 * `scripts/check-plan-table.py` proves METERS and TIERS still match
 * libs/metering, which is the side that actually enforces the limits.
 * ------------------------------------------------------------------ */

/** Every metered dimension, in the order the UI lists them. */
export const METERS = [
  "voice_minutes",
  "watcher_runs",
  "connector_calls",
  "documents",
  "meeting_insights",
  "bot_hours",
  "images",
  "draft_video_seconds",
  "final_video_seconds",
] as const;

export const TIERS = ["free", "plus", "team", "max"] as const;

export const MeterNameSchema = z.enum(METERS);
export const TierSchema = z.enum(TIERS);

export const MeterSchema = z.object({
  meter: MeterNameSchema,
  used: z.number(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  nearLimit: z.boolean(),
});

export const SubscriptionStatusSchema = z.enum([
  "free",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
]);

export const UsageSchema = z.object({
  tier: TierSchema,
  label: z.string(),
  pricePence: z.number(),
  period: z.string(),
  meters: z.array(MeterSchema),
  /** Stripe subscription status. Missing/unknown is treated as free. */
  status: SubscriptionStatusSchema.default("free"),
  /** True once a Stripe customer exists, so Manage plan can open the portal. */
  hasBilling: z.boolean().default(false),
  cancelAtPeriodEnd: z.boolean().default(false),
  currentPeriodEnd: z.string().nullable().default(null),
});

export type MeterName = z.infer<typeof MeterNameSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type MeterReading = z.infer<typeof MeterSchema>;
export type Usage = z.infer<typeof UsageSchema>;
