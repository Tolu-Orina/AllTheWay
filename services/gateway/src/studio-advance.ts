import type { ArtifactDetail } from "@alltheway/contracts";

import { runConnectorTool, readableDetail } from "./act.js";
import { concatMp4 } from "./join-video.js";
import {
  persistGeneratedMedia,
  persistMediaBytes,
  STUDIO_SESSION_ID,
  videoPollFromConnectorTask,
  videoStartFromConnectorTask,
} from "./media-persist.js";
import { env } from "./env.js";
import { getArtifact } from "./repos/artifacts.js";
import { planVideoShots } from "./studio-plan.js";
import { SHOT_MAX_SECONDS } from "./studio-shots.js";
import {
  claimPersist,
  claimPoll,
  claimShotStart,
  getStudioJob,
  releasePoll,
  scratchArtifactId,
  STARTING_OPERATION,
  updateStudioJob,
  type StudioJob,
} from "./repos/studio-jobs.js";
import { gcsStore } from "./storage.js";

/**
 * One GET, one billed Vertex step.
 *
 * The browser cannot wait for fifteen Veo operations. Each poll either
 * plans the shots, starts the current shot, asks whether that shot is
 * done, or joins what is already on disk. Starting the next shot in the
 * same request as a completed poll would hide a second bill behind a
 * status check.
 */

const VIDEO_START_TIMEOUT_MS = 90_000;
const VIDEO_POLL_TIMEOUT_MS = 20_000;

export const RENDERING =
  "Drafting a clip can take several minutes. You can leave this page.";
export const JOINING = "Joining the shots.";

export type StudioAdvance = {
  status: "queued" | "rendering" | "joining" | "ready" | "failed" | "quota" | "declined";
  message: string;
  jobId: string;
  artifact?: ArtifactDetail;
  shotIndex?: number;
  shotCount?: number;
};

export function isSequence(job: StudioJob): boolean {
  return job.seconds > SHOT_MAX_SECONDS || job.shots.length > 1;
}

export async function advanceStudioJob(uid: string, job: StudioJob): Promise<StudioAdvance> {
  if (!env.connectorGatewayUrl) {
    return {
      status: "failed",
      message: "Video generation is not available in this environment.",
      jobId: job.id,
    };
  }

  if (job.status === "joining") {
    return joinShots(uid, job);
  }

  if (job.resultArtifactId) {
    const artifact = await getArtifact(uid, job.resultArtifactId);
    return {
      status: "ready",
      message: "",
      jobId: job.id,
      artifact: artifact ?? undefined,
      shotIndex: job.shotIndex,
      shotCount: job.shots.length || undefined,
    };
  }

  if (isSequence(job) && job.shots.length === 0) {
    return planShots(uid, job);
  }

  if (job.operation === STARTING_OPERATION) {
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
    };
  }

  if (!job.operation) {
    if (isSequence(job) && job.shotIndex >= job.shots.length) {
      return joinShots(uid, job);
    }
    return startCurrentShot(uid, job);
  }

  return pollCurrent(uid, job);
}

async function planShots(uid: string, job: StudioJob): Promise<StudioAdvance> {
  const shots = await planVideoShots(job.prompt, job.seconds);
  await updateStudioJob(uid, job.id, { shots, shotIndex: 0, status: "queued" });
  return {
    status: "queued",
    message: RENDERING,
    jobId: job.id,
    shotIndex: 0,
    shotCount: shots.length,
  };
}

async function startCurrentShot(uid: string, job: StudioJob): Promise<StudioAdvance> {
  const shot = job.shots[job.shotIndex];
  if (!shot && isSequence(job)) {
    return joinShots(uid, job);
  }

  const claim = await claimShotStart(uid, job.id);
  if (claim.kind === "wait") {
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shotIndex,
      shotCount: job.shots.length || undefined,
    };
  }
  if (claim.kind === "poll") {
    return pollCurrent(uid, claim.job);
  }

  const prompt = shot?.prompt ?? job.prompt;
  const seconds = shot?.seconds ?? job.seconds;

  const isFinal = job.rung === "final";
  try {
    const task = await runConnectorTool({
      uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: isFinal ? "render_video" : "draft_video",
      arguments: { prompt, seconds },
      confirmed: true,
      costAcknowledged: isFinal,
      timeoutMs: VIDEO_START_TIMEOUT_MS,
    });

    const detail = readableDetail(task);
    if (/refus|not permitted|ceiling|blocked|policy|quota|allowance/i.test(detail)) {
      const quota = /quota|allowance|limit|left this month/i.test(detail);
      const message = quota
        ? job.shotIndex > 0
          ? `Shot ${job.shotIndex + 1} could not start — no draft seconds left. Earlier shots were billed.`
          : "No draft seconds left this month."
        : "The model declined that. Try a different description.";
      await updateStudioJob(uid, job.id, { status: "failed", error: message, operation: "" });
      return {
        status: quota ? "quota" : "declined",
        message,
        jobId: job.id,
        shotIndex: job.shotIndex,
        shotCount: job.shots.length,
      };
    }

    const started = videoStartFromConnectorTask(task);
    if (started.error || !started.operation) {
      const message = started.error || "Could not start that clip. Nothing was saved.";
      await updateStudioJob(uid, job.id, { status: "failed", error: message, operation: "" });
      return { status: "failed", message, jobId: job.id };
    }

    await updateStudioJob(uid, job.id, {
      status: "rendering",
      operation: started.operation,
      model: started.model || job.model,
    });
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shotIndex,
      shotCount: job.shots.length,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] shot start failed: ${msg}`);
    await updateStudioJob(uid, job.id, { operation: "" }).catch(() => undefined);
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shotIndex,
      shotCount: job.shots.length,
    };
  }
}

async function pollCurrent(uid: string, job: StudioJob): Promise<StudioAdvance> {
  if (!job.operation || job.operation === STARTING_OPERATION) {
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
    };
  }

  const claim = await claimPoll(uid, job.id);
  if (claim.kind === "ready") {
    const artifact = claim.job.resultArtifactId
      ? (await getArtifact(uid, claim.job.resultArtifactId)) ?? undefined
      : undefined;
    return { status: "ready", message: "", jobId: job.id, artifact };
  }
  if (claim.kind === "failed") {
    return { status: "failed", message: claim.job.error || "That clip could not be made.", jobId: job.id };
  }
  if (claim.kind === "wait") {
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
    };
  }

  const shot = job.shots[job.shotIndex];
  const seconds = shot?.seconds ?? job.seconds;

  try {
    const task = await runConnectorTool({
      uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: job.rung === "final" ? "poll_final_video" : "poll_draft_video",
      arguments: {
        operation: job.operation,
        model: job.model,
        seconds,
      },
      confirmed: true,
      timeoutMs: VIDEO_POLL_TIMEOUT_MS,
    });

    const poll = videoPollFromConnectorTask(task);
    if (poll.error && !poll.body) {
      await updateStudioJob(uid, job.id, { status: "failed", error: poll.error, polling: false });
      return { status: "failed", message: poll.error, jobId: job.id };
    }

    if (!poll.done) {
      if (job.status !== "rendering") {
        await updateStudioJob(uid, job.id, { status: "rendering" });
      }
      return {
        status: "rendering",
        message: RENDERING,
        jobId: job.id,
        shotIndex: job.shots.length ? job.shotIndex : undefined,
        shotCount: job.shots.length || undefined,
      };
    }

    if (isSequence(job) && poll.body) {
      await gcsStore.put(
        uid,
        scratchArtifactId(job.id),
        job.shotIndex,
        poll.body,
        poll.mimeType || "video/mp4",
      );
      const nextIndex = job.shotIndex + 1;
      if (nextIndex >= job.shots.length) {
        await updateStudioJob(uid, job.id, {
          status: "joining",
          operation: "",
          shotIndex: nextIndex,
          polling: false,
        });
        const latest = await getStudioJob(uid, job.id);
        return joinShots(uid, latest ?? { ...job, shotIndex: nextIndex, status: "joining" });
      }
      await updateStudioJob(uid, job.id, {
        status: "rendering",
        operation: "",
        shotIndex: nextIndex,
        polling: false,
      });
      return {
        status: "rendering",
        message: RENDERING,
        jobId: job.id,
        shotIndex: nextIndex,
        shotCount: job.shots.length,
      };
    }

    const persist = await claimPersist(uid, job.id);
    if (persist.kind === "already") {
      const artifact = persist.job.resultArtifactId
        ? (await getArtifact(uid, persist.job.resultArtifactId)) ?? undefined
        : undefined;
      return { status: "ready", message: "", jobId: job.id, artifact };
    }
    if (persist.kind === "wait") {
      return {
        status: "rendering",
        message: RENDERING,
        jobId: job.id,
      };
    }

    const saved = await persistGeneratedMedia({
      uid,
      sessionId: STUDIO_SESSION_ID,
      tool: job.rung === "final" ? "render_video" : "draft_video",
      prompt: job.prompt,
      task,
      artifactId: job.artifactId || undefined,
    });

    if (saved && "error" in saved) {
      await updateStudioJob(uid, job.id, { status: "failed", error: saved.error, persisting: false });
      return { status: "failed", message: saved.error, jobId: job.id };
    }
    if (!saved || !("artifact" in saved)) {
      const message = "The clip finished but could not be saved.";
      await updateStudioJob(uid, job.id, { status: "failed", error: message, persisting: false });
      return { status: "failed", message, jobId: job.id };
    }

    await updateStudioJob(uid, job.id, {
      status: "ready",
      resultArtifactId: saved.artifact.id,
      persisting: false,
      polling: false,
    });
    return {
      status: "ready",
      message: "",
      jobId: job.id,
      artifact: saved.artifact,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] poll failed: ${msg}`);
    return {
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
    };
  } finally {
    await releasePoll(uid, job.id).catch(() => undefined);
  }
}

async function joinShots(uid: string, job: StudioJob): Promise<StudioAdvance> {
  const count = job.shots.length;
  if (count < 1) {
    const message = "Nothing to join.";
    await updateStudioJob(uid, job.id, { status: "failed", error: message });
    return { status: "failed", message, jobId: job.id };
  }

  if (job.status !== "joining") {
    await updateStudioJob(uid, job.id, { status: "joining", operation: "" });
  }

  const persist = await claimPersist(uid, job.id);
  if (persist.kind === "already") {
    const artifact = persist.job.resultArtifactId
      ? (await getArtifact(uid, persist.job.resultArtifactId)) ?? undefined
      : undefined;
    return { status: "ready", message: "", jobId: job.id, artifact, shotIndex: count, shotCount: count };
  }
  if (persist.kind === "wait") {
    return { status: "joining", message: JOINING, jobId: job.id, shotIndex: job.shotIndex, shotCount: count };
  }

  try {
    const clips: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      clips.push(await gcsStore.get(uid, scratchArtifactId(job.id), i));
    }
    const body = await concatMp4(clips);
    const saved = await persistMediaBytes({
      uid,
      sessionId: STUDIO_SESSION_ID,
      prompt: job.prompt,
      body,
      mimeType: "video/mp4",
      kind: "video",
      model: job.model,
      artifactId: job.artifactId || undefined,
      sources: [`assembled from ${count} shots`],
    });

    if ("error" in saved) {
      await updateStudioJob(uid, job.id, { status: "failed", error: saved.error });
      return { status: "failed", message: saved.error, jobId: job.id };
    }

    await gcsStore.deleteAll(uid, scratchArtifactId(job.id)).catch((err) => {
      console.warn(`[studio] scratch cleanup failed: ${(err as Error).message}`);
    });
    await updateStudioJob(uid, job.id, {
      status: "ready",
      resultArtifactId: saved.artifact.id,
      operation: "",
      persisting: false,
    });
    return {
      status: "ready",
      message: "",
      jobId: job.id,
      artifact: saved.artifact,
      shotIndex: count,
      shotCount: count,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] join failed: ${msg}`);
    if (/ffmpeg is not available|ENOENT|spawn .* ENOENT/i.test(msg)) {
      const message =
        "Shots were drafted but could not be joined. Nothing was saved as one clip.";
      await updateStudioJob(uid, job.id, { status: "failed", error: message });
      return { status: "failed", message, jobId: job.id, shotIndex: job.shotIndex, shotCount: count };
    }
    return {
      status: "joining",
      message: JOINING,
      jobId: job.id,
      shotIndex: job.shotIndex,
      shotCount: count,
    };
  }
}
