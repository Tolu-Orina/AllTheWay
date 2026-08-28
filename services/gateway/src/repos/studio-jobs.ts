import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";

import { studioJobs } from "../firestore.js";

/**
 * A Veo draft that outlives the HTTP request that started it.
 *
 * Vertex bills when `predictLongRunning` returns an operation name. The browser
 * cannot wait seven minutes, so the name is stored here and each subsequent
 * GET does one poll.
 */

export type StudioJobStatus = "queued" | "rendering" | "ready" | "failed";

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
  createdAt: string;
  updatedAt: string;
};

const iso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString();

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
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}

export async function createStudioJob(opts: {
  uid: string;
  operation: string;
  model: string;
  prompt: string;
  seconds: number;
  artifactId?: string;
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
  const [queued, rendering] = await Promise.all([
    col.where("status", "==", "queued").get(),
    col.where("status", "==", "rendering").get(),
  ]);
  return [...queued.docs, ...rendering.docs]
    .map((d) => toJob(d.id, d.data()))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function updateStudioJob(
  uid: string,
  id: string,
  patch: Partial<{
    status: StudioJobStatus;
    resultArtifactId: string;
    error: string;
  }>,
): Promise<void> {
  await studioJobs(uid).doc(id).update({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
