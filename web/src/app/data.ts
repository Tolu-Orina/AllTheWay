import {
  LearnedPreferenceSchema,
  SessionDetailSchema,
  SessionSchema,
  WatcherRunSchema,
  WatcherSchema,
  type SessionDetail,
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
  Session,
  SessionDetail,
  Watcher,
  WatcherRun,
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

export const MeterSchema = z.object({
  meter: z.enum(["voice_minutes", "watcher_runs", "connector_calls"]),
  used: z.number(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  nearLimit: z.boolean(),
});

export const UsageSchema = z.object({
  tier: z.enum(["free", "plus", "team"]),
  label: z.string(),
  pricePence: z.number(),
  period: z.string(),
  meters: z.array(MeterSchema),
});

export type Usage = z.infer<typeof UsageSchema>;
export type MeterReading = z.infer<typeof MeterSchema>;

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

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string().optional().default(""),
  pages: z.number().optional().default(0),
  chunks: z.number().optional().default(0),
  status: z.enum(["screening", "indexing", "ready", "blocked"]),
  blockedReason: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
});

export const DocumentListSchema = z.object({ documents: z.array(DocumentSchema) });

export type UserDocument = z.infer<typeof DocumentSchema>;

export const api = {
  sessions: () => apiGet("/sessions", z.array(SessionSchema)),
  session: (id: string) =>
    apiGet(`/sessions/${encodeURIComponent(id)}`, SessionDetailSchema.nullable()),
  watchers: () => apiGet("/watchers", z.array(WatcherSchema)),
  watcherRuns: () => apiGet("/watcher-runs", z.array(WatcherRunSchema)),
  preferences: () => apiGet("/preferences", z.array(LearnedPreferenceSchema)),

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
    },
  ) => apiPost(`/sessions/${encodeURIComponent(sessionId)}/decision`, body),

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

  /* --- Documents (v3 Phase B) -------------------------------------- */

  documents: () => apiGet("/documents", DocumentListSchema),

  /**
   * Upload a document.
   *
   * Base64 rather than multipart: JSON is the transport for the rest of this
   * API, and a second parsing path would be a second thing to keep correct.
   */
  uploadDocument: (title: string, content: string, mimeType: string) =>
    apiPost("/documents", { title, content, mimeType }),

  deleteDocument: (id: string) =>
    apiDelete(`/documents/${encodeURIComponent(id)}`),

  /* --- Artifacts (v3 Phase A) ------------------------------------- */

  artifacts: () => apiGet("/artifacts", z.array(ArtifactSchema)),

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

  /** The agent registry, with each card's signature checked at read time. */
  agents: () => apiGet("/registry/agents", RegistrySchema),

  /**
   * Begins consent. Returns the Google URL to send the browser to.
   *
   * The URL is built server-side because it carries `state`, which must be
   * minted and stored against this user. A client-built consent URL is a
   * client-chosen state, which is the whole CSRF hole.
   */
  connectGoogle: (options: { drafts?: boolean } = {}) =>
    apiPost("/connectors/google/connect", options, z.object({ url: z.string().url() })),

  setWatcherRunning: (id: string, running: boolean) =>
    apiPost(`/watchers/${encodeURIComponent(id)}/running`, { running }, WatcherSchema),
  revertPreference: (id: string) => apiPost("/preferences/revert", { id }),

  /** Home needs the in-progress session; the list is already sorted by recency. */
  homePlan: async (): Promise<SessionDetail | null> => {
    const rows = await apiGet("/sessions", z.array(SessionSchema));
    const inProgress = rows.find((s) => s.done < s.total) ?? rows[0];
    if (!inProgress) return null;
    return apiGet(`/sessions/${encodeURIComponent(inProgress.id)}`, SessionDetailSchema.nullable());
  },
};
