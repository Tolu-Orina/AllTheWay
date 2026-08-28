import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

import { db, studioJobs } from "../firestore.js";

/**
 * A Veo draft that outlives the HTTP request that started it.
 *
 * Vertex bills when `predictLongRunning` returns an operation name. The browser
 * cannot wait seven minutes, so the name is stored here and each subsequent
 * GET does one poll — or, for a longer clip, starts the next eight-second shot.
 */

export type StudioJobStatus = "queued" | "rendering" | "joining" | "ready" | "failed";

export type StudioJobShot = {
  seconds: number;
  prompt: string;
};

export type StudioJob = {
  id: string;
  status: StudioJobStatus;
  operation: string;
  model: string;
  prompt: string;
  seconds: number;
  rung: "draft";
  artifactId: string;
  resultArtifactId: string;
  error: string;
  shots: StudioJobShot[];
  shotIndex: number;
  polling: boolean;
  persisting: boolean;
  createdAt: string;
  updatedAt: string;
};

const iso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString();

function toShots(raw: unknown): StudioJobShot[] {
  if (!Array.isArray(raw)) return [];
  const shots: StudioJobShot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { seconds?: unknown; prompt?: unknown };
    const prompt = typeof rec.prompt === "string" ? rec.prompt : "";
    const seconds =
      typeof rec.seconds === "number" && Number.isFinite(rec.seconds) ? rec.seconds : 0;
    if (!prompt || seconds < 1) continue;
    shots.push({ prompt, seconds });
  }
  return shots;
}

function toJob(id: string, data: FirebaseFirestore.DocumentData): StudioJob {
  return {
    id,
    status: (data.status as StudioJobStatus) ?? "queued",
    operation: data.operation ?? "",
    model: data.model ?? "",
    prompt: data.prompt ?? "",
    seconds: data.seconds ?? 0,
    rung: "draft",
    artifactId: data.artifactId ?? "",
    resultArtifactId: data.resultArtifactId ?? "",
    error: data.error ?? "",
    shots: toShots(data.shots),
    shotIndex: typeof data.shotIndex === "number" ? data.shotIndex : 0,
    polling: data.polling === true,
    persisting: data.persisting === true,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}

export function scratchArtifactId(jobId: string): string {
  return `studiojob-${jobId}`;
}

export async function createStudioJob(opts: {
  uid: string;
  operation: string;
  model: string;
  prompt: string;
  seconds: number;
  artifactId?: string;
  shots?: StudioJobShot[];
}): Promise<StudioJob> {
  const id = randomUUID();
  const ref = studioJobs(opts.uid).doc(id);
  await ref.set({
    status: "queued",
    operation: opts.operation,
    model: opts.model,
    prompt: opts.prompt,
    seconds: opts.seconds,
    rung: "draft",
    artifactId: opts.artifactId ?? "",
    resultArtifactId: "",
    error: "",
    shots: opts.shots ?? [],
    shotIndex: 0,
    polling: false,
    persisting: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  return toJob(id, snap.data() ?? {});
}

export async function getStudioJob(uid: string, id: string): Promise<StudioJob | null> {
  const snap = await studioJobs(uid).doc(id).get();
  if (!snap.exists) return null;
  return toJob(id, snap.data() ?? {});
}

export async function listOpenStudioJobs(uid: string): Promise<StudioJob[]> {
  const col = studioJobs(uid);
  const [queued, rendering, joining] = await Promise.all([
    col.where("status", "==", "queued").get(),
    col.where("status", "==", "rendering").get(),
    col.where("status", "==", "joining").get(),
  ]);
  return [...queued.docs, ...rendering.docs, ...joining.docs]
    .map((d) => toJob(d.id, d.data()))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function updateStudioJob(
  uid: string,
  id: string,
  patch: Partial<{
    status: StudioJobStatus;
    operation: string;
    model: string;
    resultArtifactId: string;
    error: string;
    shots: StudioJobShot[];
    shotIndex: number;
    polling: boolean;
    persisting: boolean;
  }>,
): Promise<void> {
  await studioJobs(uid).doc(id).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Sentinel written before Vertex is called. A second GET that still sees
 * this must not start another billed operation — it waits.
 */
export const STARTING_OPERATION = "starting";

function stale(job: StudioJob, ms: number): boolean {
  const at = Date.parse(job.updatedAt);
  if (!Number.isFinite(at) || at === 0) return true;
  return Date.now() - at > ms;
}

export type ShotStartClaim = { kind: "go" | "poll" | "wait"; job: StudioJob };

/**
 * Exactly one request may call draft_video for the current shot.
 *
 * Overlapping GETs (React Strict Mode remounts the poll effect) used to
 * both see an empty operation and both start Veo. Vertex billed twice;
 * the second write overwrote the first operation name.
 */
export async function claimShotStart(uid: string, id: string): Promise<ShotStartClaim> {
  const ref = studioJobs(uid).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("That job is not here.");
    const job = toJob(id, snap.data() ?? {});
    if (job.operation && job.operation !== STARTING_OPERATION) {
      return { kind: "poll" as const, job };
    }
    if (job.operation === STARTING_OPERATION && !stale(job, 90_000)) {
      return { kind: "wait" as const, job };
    }
    tx.update(ref, {
      operation: STARTING_OPERATION,
      status: "rendering",
      polling: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: "go" as const, job };
  });
}

export type PollClaim = { kind: "go" | "wait" | "ready" | "failed"; job: StudioJob };

/**
 * Exactly one request may fetchPredictOperation at a time.
 *
 * A completed Veo response is a large video in JSON. Two in-flight polls
 * each materialised that payload on connector-gateway and both instances
 * OOM'd at 512Mi (2026-08-28 17:16).
 */
export async function claimPoll(uid: string, id: string): Promise<PollClaim> {
  const ref = studioJobs(uid).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("That job is not here.");
    const job = toJob(id, snap.data() ?? {});
    if (job.resultArtifactId) return { kind: "ready" as const, job };
    if (job.status === "failed") return { kind: "failed" as const, job };
    if (job.persisting && !stale(job, 60_000)) return { kind: "wait" as const, job };
    if (job.polling && !stale(job, 60_000)) return { kind: "wait" as const, job };
    tx.update(ref, { polling: true, updatedAt: FieldValue.serverTimestamp() });
    return { kind: "go" as const, job };
  });
}

export async function releasePoll(uid: string, id: string): Promise<void> {
  await studioJobs(uid).doc(id).update({
    polling: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export type PersistClaim = { kind: "go" | "wait" | "already"; job: StudioJob };

export async function claimPersist(uid: string, id: string): Promise<PersistClaim> {
  const ref = studioJobs(uid).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("That job is not here.");
    const job = toJob(id, snap.data() ?? {});
    if (job.resultArtifactId) return { kind: "already" as const, job };
    if (job.persisting && !stale(job, 60_000)) return { kind: "wait" as const, job };
    tx.update(ref, {
      persisting: true,
      polling: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: "go" as const, job };
  });
}
