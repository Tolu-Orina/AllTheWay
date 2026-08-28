import express from "express";
import { z } from "zod";

import { env } from "../env.js";
import { requireUser } from "../auth.js";
import { runConnectorTool, readableDetail } from "../act.js";
import {
  persistGeneratedMedia,
  STUDIO_SESSION_ID,
  videoPollFromConnectorTask,
  videoStartFromConnectorTask,
} from "../media-persist.js";
import { getArtifact } from "../repos/artifacts.js";
import {
  createStudioJob,
  getStudioJob,
  listOpenStudioJobs,
  updateStudioJob,
} from "../repos/studio-jobs.js";

/**
 * Studio Generate is consent.
 *
 * The companion asks Yes because it inferred a request. Here they typed the
 * prompt and pressed the button — that is the yes. The floor still receives
 * `confirmed: true`. The UI must not ask twice.
 *
 * Video is a job, not a request that waits. Veo often takes longer than the
 * connector-gateway's 300s timeout, and Firebase Hosting dies at 60s.
 * Starting the long-running operation and polling it is the only shape that
 * can tell the truth about wait and cost.
 */

export const studioRoutes = express.Router();

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  mode: z.enum(["image", "video"]),
  seconds: z.number().int().min(1).max(8).optional(),
  artifactId: z.string().max(128).optional(),
  costAcknowledged: z.boolean().optional(),
});

const IMAGE_TIMEOUT_MS = 90_000;
const VIDEO_START_TIMEOUT_MS = 90_000;
const VIDEO_POLL_TIMEOUT_MS = 20_000;

const RENDERING =
  "Drafting a clip can take several minutes. You can leave this page.";

studioRoutes.post("/generate", requireUser, async (req, res) => {
  const body = GenerateSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      code: "invalid_request",
      message: "Describe what to make first.",
    });
  }

  const { prompt, mode, artifactId } = body.data;
  const uid = req.uid!;

  if (!env.connectorGatewayUrl) {
    return res.status(503).json({
      code: "not_configured",
      message:
        mode === "video"
          ? "Video generation is not available in this environment."
          : "Image generation is not available in this environment.",
    });
  }

  if (mode === "video") {
    return startVideo(req, res, {
      uid,
      prompt,
      seconds: body.data.seconds ?? 6,
      artifactId,
    });
  }

  try {
    const task = await runConnectorTool({
      uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: "generate_image",
      arguments: { prompt, style: "" },
      confirmed: true,
      timeoutMs: IMAGE_TIMEOUT_MS,
    });

    const detail = readableDetail(task);
    if (/refus|not permitted|ceiling|blocked|policy|quota|allowance/i.test(detail)) {
      const quota = /quota|allowance|limit|left this month/i.test(detail);
      return res.json({
        status: quota ? "quota" : "declined",
        message: quota
          ? "No images left this month."
          : "The model declined that. Try a different description.",
      });
    }

    const saved = await persistGeneratedMedia({
      uid,
      sessionId: STUDIO_SESSION_ID,
      tool: "generate_image",
      prompt,
      task,
      artifactId,
    });

    if (saved && "error" in saved) {
      return res.json({ status: "failed", message: saved.error });
    }
    if (!saved || !("artifact" in saved)) {
      return res.json({
        status: "failed",
        message: "The still came back in a shape we could not save.",
      });
    }

    return res.json({ status: "ready", message: "", artifact: saved.artifact });
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] generate failed: ${msg}`);
    if (/did not answer in time/i.test(msg)) {
      return res.json({
        status: "failed",
        message: "The image model took too long. Nothing was saved.",
      });
    }
    return res.json({
      status: "failed",
      message: "Could not reach the image model. Nothing was saved.",
    });
  }
});

studioRoutes.get("/jobs", requireUser, async (req, res) => {
  const jobs = await listOpenStudioJobs(req.uid!);
  return res.json(
    jobs.map((job) => ({
      jobId: job.id,
      status: job.status,
      prompt: job.prompt,
      seconds: job.seconds,
    })),
  );
});

studioRoutes.get("/jobs/:id", requireUser, async (req, res) => {
  const uid = req.uid!;
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) {
    return res.status(400).json({ code: "invalid_request", message: "Missing job." });
  }

  const job = await getStudioJob(uid, id);
  if (!job) {
    return res.status(404).json({ code: "not_found", message: "That job is not here." });
  }

  if (job.status === "ready" && job.resultArtifactId) {
    const artifact = await getArtifact(uid, job.resultArtifactId);
    return res.json({
      status: "ready",
      message: "",
      jobId: job.id,
      artifact: artifact ?? undefined,
    });
  }

  if (job.status === "failed") {
    return res.json({
      status: "failed",
      message: job.error || "That clip could not be made.",
      jobId: job.id,
    });
  }

  if (!env.connectorGatewayUrl) {
    return res.status(503).json({
      code: "not_configured",
      message: "Video generation is not available in this environment.",
    });
  }

  try {
    const task = await runConnectorTool({
      uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: "poll_draft_video",
      arguments: {
        operation: job.operation,
        model: job.model,
        seconds: job.seconds,
      },
      confirmed: true,
      timeoutMs: VIDEO_POLL_TIMEOUT_MS,
    });

    const poll = videoPollFromConnectorTask(task);
    if (poll.error && !poll.body) {
      await updateStudioJob(uid, job.id, { status: "failed", error: poll.error });
      return res.json({ status: "failed", message: poll.error, jobId: job.id });
    }

    if (!poll.done) {
      if (job.status !== "rendering") {
        await updateStudioJob(uid, job.id, { status: "rendering" });
      }
      return res.json({ status: "rendering", message: RENDERING, jobId: job.id });
    }

    const saved = await persistGeneratedMedia({
      uid,
      sessionId: STUDIO_SESSION_ID,
      tool: "draft_video",
      prompt: job.prompt,
      task,
      artifactId: job.artifactId || undefined,
    });

    if (saved && "error" in saved) {
      await updateStudioJob(uid, job.id, { status: "failed", error: saved.error });
      return res.json({ status: "failed", message: saved.error, jobId: job.id });
    }
    if (!saved || !("artifact" in saved)) {
      const message = "The clip finished but could not be saved.";
      await updateStudioJob(uid, job.id, { status: "failed", error: message });
      return res.json({ status: "failed", message, jobId: job.id });
    }

    await updateStudioJob(uid, job.id, {
      status: "ready",
      resultArtifactId: saved.artifact.id,
    });
    return res.json({
      status: "ready",
      message: "",
      jobId: job.id,
      artifact: saved.artifact,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] poll failed: ${msg}`);
    return res.json({
      status: "rendering",
      message: RENDERING,
      jobId: job.id,
    });
  }
});

async function startVideo(
  _req: express.Request,
  res: express.Response,
  opts: { uid: string; prompt: string; seconds: number; artifactId?: string },
) {
  try {
    const task = await runConnectorTool({
      uid: opts.uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: "draft_video",
      arguments: { prompt: opts.prompt, seconds: opts.seconds },
      confirmed: true,
      timeoutMs: VIDEO_START_TIMEOUT_MS,
    });

    const detail = readableDetail(task);
    if (/refus|not permitted|ceiling|blocked|policy|quota|allowance/i.test(detail)) {
      const quota = /quota|allowance|limit|left this month/i.test(detail);
      return res.json({
        status: quota ? "quota" : "declined",
        message: quota
          ? "No draft seconds left this month."
          : "The model declined that. Try a different description.",
      });
    }

    const started = videoStartFromConnectorTask(task);
    if (started.error || !started.operation) {
      return res.json({
        status: "failed",
        message: started.error || "Could not start that clip. Nothing was saved.",
      });
    }

    const job = await createStudioJob({
      uid: opts.uid,
      operation: started.operation,
      model: started.model ?? "",
      prompt: opts.prompt,
      seconds: opts.seconds,
      artifactId: opts.artifactId,
    });

    return res.json({
      status: "queued",
      message: RENDERING,
      jobId: job.id,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[studio] video start failed: ${msg}`);
    if (/did not answer in time/i.test(msg)) {
      return res.json({
        status: "failed",
        message: "The video model took too long to start. If a draft was begun, it may still complete.",
      });
    }
    return res.json({
      status: "failed",
      message: "Could not start that clip.",
    });
  }
}
