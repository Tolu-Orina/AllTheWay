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
