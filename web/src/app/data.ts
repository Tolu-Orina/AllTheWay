import {
  LearnedPreferenceSchema,
  SessionDetailSchema,
  SessionSchema,
  WatcherRunSchema,
  WatcherSchema,
  type SessionDetail,
} from "@alltheway/contracts";
import { z } from "zod";

import { apiGet, apiPost } from "@/lib/api";

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
