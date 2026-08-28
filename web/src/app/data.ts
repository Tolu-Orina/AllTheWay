import {
  LearnedPreferenceSchema,
  VisualPreferenceSchema,
  ConceptSchema,
  MeetingSchema,
  InsightSchema,
  CommitmentSchema,
  ShareSchema,
  CommentSchema,
  SharedArtifactSchema,
  DecisionResultSchema,
  DigestSchema,
  OnboardingSchema,
  HomeSchema,
  SessionDetailSchema,
  SessionSchema,
  WatcherRunSchema,
  WatcherSchema,
  PersonSchema,
  PlaceSchema,
  RhythmSchema,
  ReminderSchema,
  ProposedCommitmentSchema,
  type OnboardingJob,
  type LifeContext,
  UsageSchema,
} from "@alltheway/contracts";
import { z } from "zod";

import { apiBlob, apiDelete, apiGet, apiPost, apiText } from "@/lib/api";

/**
 * Data access for the product app.
 *
 * Every model and every schema comes from @alltheway/contracts, which the
 * gateway also imports — so a field cannot be renamed on one side and quietly
 * keep working on the other. There is no mock data here any more.
 */

export type {
  LearnedPreference,
  VisualPreference,
  Concept,
  Meeting,
  Insight,
  Commitment,
  Share,
  Comment,
  SharedArtifact,
  Digest,
  Onboarding,
  OnboardingJob,
  LifeContext,
  Session,
  SessionDetail,
  Watcher,
  WatcherRun,
  Home,
  Day,
  DayItem,
  Hat,
  Person,
  Place,
  Rhythm,
  Reminder,
  ProposedCommitment,
} from "@alltheway/contracts";

export const ConnectorSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  status: z.enum(["available", "coming_soon"]),
  connected: z.boolean(),
});

export const ConnectorListSchema = z.object({
  connectors: z.array(ConnectorSchema),
  grantedScopes: z.array(z.string()),
});

export type Connector = z.infer<typeof ConnectorSchema>;

// MeterSchema and UsageSchema now come from @alltheway/contracts, imported
// above. They were declared here with three of the seven meters and three of
// the four tiers, so `meeting_insights` failed validation and the usage panel
// showed "We could not load this" over a wall of Zod output.

export type { Usage, MeterReading } from "@alltheway/contracts";

export const AgentSchema = z.object({
  id: z.string(),
  owner: z.string(),
  purpose: z.string(),
  reachable: z.boolean(),
  name: z.string(),
  version: z.string(),
  advertisedUrl: z.string(),
  skills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  signature: z
    .object({ state: z.string(), kid: z.string(), summary: z.string(), trusted: z.boolean() })
    .nullable(),
  error: z.string(),
});

export const RegistrySchema = z.object({
  agents: z.array(AgentSchema),
  checkedAt: z.string(),
  summary: z.object({ total: z.number(), reachable: z.number(), trusted: z.number() }),
});

export type Agent = z.infer<typeof AgentSchema>;

export const ArtifactVersionSchema = z.object({
  n: z.number(),
  mimeType: z.string(),
  bytes: z.number(),
  createdAt: z.string(),
  producedBy: z.enum(["user", "agent"]),
  prompt: z.string(),
  correction: z.string(),
  supersedes: z.number().nullable(),
});

export const ArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum(["doc", "image", "video", "summary", "checklist"]),
  title: z.string(),
  sessionId: z.string(),
  currentVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  provenance: z.object({
    agentId: z.string(),
    cardVersion: z.string(),
    model: z.string(),
    sources: z.array(z.string()),
  }),
});

export const ArtifactDetailSchema = ArtifactSchema.extend({
  versions: z.array(ArtifactVersionSchema),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const StudioPlanSchema = z.object({
  seconds: z.number(),
  shots: z.array(
    z.object({
      prompt: z.string(),
      seconds: z.number(),
    }),
  ),
});

export const StudioGenerateSchema = z.object({
  status: z.enum(["ready", "queued", "rendering", "joining", "not_ready", "declined", "quota", "failed"]),
  message: z.string(),
  artifact: ArtifactDetailSchema.optional(),
  jobId: z.string().optional(),
  shotIndex: z.number().optional(),
  shotCount: z.number().optional(),
});

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string().optional().default(""),
  pages: z.number().optional().default(0),
  chunks: z.number().optional().default(0),
  status: z.enum(["screening", "indexing", "ready", "blocked"]),
  blockedReason: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
  hat: z.enum(["work", "home", "church"]).nullable().optional(),
});

export const DocumentListSchema = z.object({ documents: z.array(DocumentSchema) });

export type UserDocument = z.infer<typeof DocumentSchema>;

export const api = {
  sessions: () => apiGet("/sessions", z.array(SessionSchema)),
  home: () => apiGet("/home", HomeSchema),
  session: (id: string) =>
    apiGet(`/sessions/${encodeURIComponent(id)}`, SessionDetailSchema.nullable()),
  createSession: () => apiPost("/sessions", {}, z.object({ id: z.string().min(1) })),
  endSession: (id: string) =>
    apiPost(
      `/sessions/${encodeURIComponent(id)}/end`,
      {},
      z.object({ ok: z.boolean(), messageId: z.string().nullable().optional() }),
    ),
  watchers: () => apiGet("/watchers", z.array(WatcherSchema)),
  createWatcher: (body: {
    name: string;
    instruction: string;
    triggerKind: "schedule" | "session_ended" | "document_indexed";
    intervalMinutes?: number;
    ceiling?: "draft_only" | "send_after_review" | "send_automatically";
  }) => apiPost("/watchers", body, WatcherSchema),
  watcherRuns: () => apiGet("/watcher-runs", z.array(WatcherRunSchema)),
  preferences: () => apiGet("/preferences", z.array(LearnedPreferenceSchema)),
  visualPreferences: () =>
    apiGet("/visual-preferences", z.array(VisualPreferenceSchema)),
  meetings: () => apiGet("/meetings", z.array(MeetingSchema)),
  meetingInsights: (meetingId: string) =>
    apiGet(`/meetings/${meetingId}/insights`, z.array(InsightSchema)),
  shares: (artifactId: string) =>
    apiGet(`/artifacts/${artifactId}/shares`, z.array(ShareSchema)),
  sharedWithMe: () => apiGet("/shared-with-me", z.array(SharedArtifactSchema)),
  digest: () => apiGet("/digest", DigestSchema),
  comments: (artifactId: string, owner?: string) =>
    apiGet(
      `/artifacts/${artifactId}/comments${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`,
      z.array(CommentSchema),
    ),
  commitments: (meetingId: string) =>
    apiGet(`/meetings/${meetingId}/commitments`, z.array(CommitmentSchema)),

  /**
   * What the user confirmed or declined (FR-V5).
   *
   * Posted from here rather than inferred on the server: the browser is the
   * only place that knows whether a person actually pressed yes, and a ledger
   * of what we assumed is worth nothing.
   */
  recordDecision: (
    sessionId: string,
    body: {
      kind: "confirmed" | "declined" | "corrected";
      summary: string;
      actions: { label: string; action: string; reason: string }[];
      modality?: "voice" | "text";
      confidence?: number;
      now?: string;
    },
  ) => apiPost(`/sessions/${encodeURIComponent(sessionId)}/decision`, body, DecisionResultSchema),

  /**
   * Connected accounts.
   *
   * The catalogue is served by the gateway rather than held here, so a
   * connector that is not ready cannot be made to look ready by editing the
   * front end — "coming soon" is a fact about the backend.
   */
  connectors: () => apiGet("/connectors", ConnectorListSchema),

  /**
   * Where this account stands this month.
   *
   * Advisory. Entitlement is decided in the connector gateway beside the
   * autonomy floor — this exists so a limit can be seen coming rather than
   * discovered by being refused.
   */
  usage: () => apiGet("/usage", UsageSchema),
  billingCheckout: (plan: "plus" | "max" = "plus") =>
    apiPost("/billing/checkout", { plan }, z.object({ url: z.string().url() })),
  billingPortal: () =>
    apiPost("/billing/portal", {}, z.object({ url: z.string().url() })),

  /* --- Documents (v3 Phase B) -------------------------------------- */

  documents: () => apiGet("/documents", DocumentListSchema),

  /**
   * Upload a document.
   *
   * Base64 rather than multipart: JSON is the transport for the rest of this
   * API, and a second parsing path would be a second thing to keep correct.
   */
  uploadDocument: (
    title: string,
    content: string,
    mimeType: string,
    hat?: "work" | "home" | "church" | null,
  ) =>
    apiPost(
      "/documents",
      { title, content, mimeType, hat: hat ?? null },
      z.object({ documentId: z.string().optional() }),
    ),

  deleteDocument: (id: string) =>
    apiDelete(`/documents/${encodeURIComponent(id)}`),

  /* --- Artifacts (v3 Phase A) ------------------------------------- */

  artifacts: (sessionId?: string) =>
    apiGet(
      sessionId
        ? `/artifacts?sessionId=${encodeURIComponent(sessionId)}`
        : "/artifacts",
      z.array(ArtifactSchema),
    ),

  artifact: (id: string) =>
    apiGet(`/artifacts/${encodeURIComponent(id)}`, ArtifactDetailSchema),

  /**
   * A correction, which is the point of the whole feature.
   *
   * `correction` is what the user said was wrong with the previous version —
   * kept because it is the learning signal, not because it is metadata.
   */
  editArtifact: (id: string, content: string, correction: string, mimeType = "text/markdown") =>
    apiPost(
      `/artifacts/${encodeURIComponent(id)}/versions`,
      { content: btoa(unescape(encodeURIComponent(content))), correction, mimeType, producedBy: "user" },
      z.object({ n: z.number() }),
    ),

  /**
   * The bytes of one version, authenticated.
   *
   * Not a URL handed to <img> or <iframe>: those cannot send the bearer token
   * and would render a 401 as a broken image. The caller makes a blob URL and
   * is responsible for revoking it.
   */
  artifactBytes: (id: string, version: number) =>
    apiBlob(`/artifacts/${encodeURIComponent(id)}/export?version=${version}`),

  artifactText: (id: string, version: number) =>
    apiText(`/artifacts/${encodeURIComponent(id)}/export?version=${version}`),

  /**
   * Studio Generate. Pressing the button is consent — confirmed on the
   * gateway, no second Yes card.
   */
  studioPlan: (body: { prompt: string; seconds: number }) =>
    apiPost("/studio/plan", body, StudioPlanSchema),

  studioGenerate: (body: {
    prompt: string;
    mode: "image" | "video";
    seconds?: number;
    artifactId?: string;
    shots?: Array<{ prompt: string; seconds: number }>;
  }) => apiPost("/studio/generate", body, StudioGenerateSchema),

  studioJob: (id: string) =>
    apiGet(`/studio/jobs/${encodeURIComponent(id)}`, StudioGenerateSchema),

  studioOpenJobs: () =>
    apiGet(
      "/studio/jobs",
      z.array(
        z.object({
          jobId: z.string(),
          status: z.enum(["queued", "rendering", "joining"]),
          prompt: z.string(),
          seconds: z.number(),
          shotIndex: z.number().optional(),
          shotCount: z.number().optional(),
        }),
      ),
    ),

  /** The agent registry, with each card's signature checked at read time. */
  agents: () => apiGet("/registry/agents", RegistrySchema),

  /**
   * Begins consent. Returns the Google URL to send the browser to.
   *
   * The URL is built server-side because it carries `state`, which must be
   * minted and stored against this user. A client-built consent URL is a
   * client-chosen state, which is the whole CSRF hole.
   */
  connectGoogle: (options: { connector: string; drafts?: boolean }) =>
    apiPost("/connectors/google/connect", options, z.object({ url: z.string().url() })),

  setWatcherRunning: (id: string, running: boolean) =>
    apiPost(`/watchers/${encodeURIComponent(id)}/running`, { running }, WatcherSchema),
  revertPreference: (id: string) => apiPost("/preferences/revert", { id }),
  acceptPreference: (id: string) => apiPost("/preferences/accept", { id }),
  setHat: (hat: "work" | "home" | "church" | null) =>
    apiPost("/hat", { hat }, z.object({ hat: z.enum(["work", "home", "church"]).nullable() })),
  concepts: () => apiGet("/concepts", z.array(ConceptSchema)),
  conceptReask: (documentId: string, label: string) =>
    apiPost("/concepts/reask", { documentId, label }, ConceptSchema.nullable()),
  conceptMiss: (documentId: string, label: string) =>
    apiPost("/concepts/miss", { documentId, label }, ConceptSchema.nullable()),
  conceptHit: (documentId: string, label: string) =>
    apiPost("/concepts/hit", { documentId, label }, ConceptSchema.nullable()),
  revertConcept: (id: string) => apiPost("/concepts/revert", { id }),
  revertVisualPreference: (id: string) =>
    apiPost("/visual-preferences/revert", { id }),
  // Confirming a commitment is what sends it through the autonomy floor.
  // Until this is called, nothing has been done about it.
  confirmCommitment: (meetingId: string, id: string) =>
    apiPost(`/meetings/${meetingId}/commitments/confirm`, { id }),
  share: (artifactId: string, email: string, role: "viewer" | "commenter") =>
    apiPost(`/artifacts/${artifactId}/shares`, { email, role }),
  revokeShare: (artifactId: string, granteeUid: string) =>
    apiDelete(`/artifacts/${artifactId}/shares/${granteeUid}`),
  comment: (artifactId: string, versionAnchor: number, body: string, owner?: string) =>
    apiPost(`/artifacts/${artifactId}/comments`, { versionAnchor, body, owner }),
  resolveComment: (artifactId: string, commentId: string, owner?: string) =>
    apiPost(`/artifacts/${artifactId}/comments/resolve`, { commentId, owner }),
  // A push token is per browser, so the same person on a laptop and a phone
  // registers two and both should ring.
  recoveryOffered: (turnId: string, failureKind: string) =>
    apiPost("/recoveries", { turnId, failureKind }),
  recoveryTaken: (id: string, routeId: string) =>
    apiPost("/recoveries/taken", { id, routeId }),
  registerPushToken: (token: string) => apiPost("/push/tokens", { token }),
  unregisterPushToken: (token: string) => apiPost("/push/tokens/remove", { token }),
  people: () => apiGet("/life/people", z.array(PersonSchema)),
  createPerson: (body: { name: string; relation?: string }) =>
    apiPost("/life/people", body, PersonSchema),
  places: () => apiGet("/life/places", z.array(PlaceSchema)),
  createPlace: (body: { label: string; bufferMinutes?: number; hat?: "work" | "home" | "church" }) =>
    apiPost("/life/places", body, PlaceSchema),
  rhythms: () => apiGet("/life/rhythms", z.array(RhythmSchema)),
  createRhythm: (body: {
    title: string;
    hat: "work" | "home" | "church";
    weekdays: number[];
    time: string;
    timeZone?: string;
    personId?: string;
    placeId?: string;
  }) => apiPost("/life/rhythms", body, RhythmSchema),
  deleteRhythm: (id: string) => apiDelete(`/life/rhythms/${encodeURIComponent(id)}`),
  reminders: () => apiGet("/life/reminders", z.array(ReminderSchema)),
  createReminder: (body: {
    title: string;
    kind?: "leave" | "start" | "prepare";
    fireAt: string;
    hat?: "work" | "home" | "church";
  }) => apiPost("/life/reminders", body, ReminderSchema),
  dismissReminder: (id: string) =>
    apiPost(`/life/reminders/${encodeURIComponent(id)}/dismiss`, {}, ReminderSchema),
  proposed: () => apiGet("/life/proposed", z.array(ProposedCommitmentSchema)),
  proposeFromDocument: (documentId: string) =>
    apiPost("/life/propose", { documentId }, z.array(ProposedCommitmentSchema)),
  acceptProposed: (id: string) =>
    apiPost(`/life/proposed/${encodeURIComponent(id)}/accept`, {}, ProposedCommitmentSchema),
  declineProposed: (id: string) =>
    apiPost(`/life/proposed/${encodeURIComponent(id)}/decline`, {}, ProposedCommitmentSchema),
  locale: () => apiGet("/settings/locale", z.object({ locale: z.string().nullable() })),
  setLocale: (locale: string) => apiPost("/settings/locale", { locale }),
  onboarding: () => apiGet("/settings/onboarding", OnboardingSchema),
  setOnboarding: (input: { job: OnboardingJob; lifeContext?: LifeContext | null }) =>
    apiPost("/settings/onboarding", input, OnboardingSchema),
  keepsTranscripts: () =>
    apiGet("/settings/voice", z.object({ keepTranscripts: z.boolean() })),
  setKeepTranscripts: (keepTranscripts: boolean) =>
    apiPost("/settings/voice", { keepTranscripts }),
  transcript: (sessionId: string) =>
    apiGet(
      `/sessions/${sessionId}/transcript`,
      z.array(z.object({ side: z.enum(["user", "model"]), text: z.string(), at: z.string() })),
    ),
  forgetTranscript: (sessionId: string) => apiDelete(`/sessions/${sessionId}/transcript`),
  meetingSettings: () =>
    apiGet("/settings/meetings", z.object({ enabled: z.boolean() })),
  setMeetingNotes: (enabled: boolean) =>
    apiPost("/settings/meetings", { enabled }),
  extendMeeting: (meetingId: string, minutes = 30) =>
    apiPost(`/meetings/${meetingId}/extend`, { minutes }),
  optOutOfMeeting: (meetingId: string) =>
    apiPost(`/meetings/${meetingId}/opt-out`, { optedOut: true }),
};
