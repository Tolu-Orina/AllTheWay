import express from "express";
import { z } from "zod";

import { env } from "../env.js";
import { requireUser } from "../auth.js";
import { runConnectorTool, readableDetail } from "../act.js";
import {
  persistGeneratedMedia,
  STUDIO_SESSION_ID,
  videoStartFromConnectorTask,
} from "../media-persist.js";
import { getArtifact } from "../repos/artifacts.js";
import {
  createStudioJob,
  getStudioJob,
  listOpenStudioJobs,
} from "../repos/studio-jobs.js";
import { mergePlan, SEQUENCE_CAP_SECONDS, SHOT_MAX_SECONDS } from "../studio-shots.js";
import { planVideoShots } from "../studio-plan.js";
import { advanceStudioJob, RENDERING } from "../studio-advance.js";

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
 *
 * Veo itself stops at eight seconds. A longer request is a sequence: Flash
 * expands the brief, each shot is billed as its own draft, and ffmpeg joins
 * the files. The joined file is an assembly — it does not inherit content
 * credentials from the shots.
 */

export const studioRoutes = express.Router();

const ShotSchema = z.object({
  prompt: z.string().min(1).max(4000),
  seconds: z.number().int().min(1).max(SHOT_MAX_SECONDS),
});

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  mode: z.enum(["image", "video"]),
  seconds: z.number().int().min(1).max(SEQUENCE_CAP_SECONDS).optional(),
  artifactId: z.string().max(128).optional(),
  costAcknowledged: z.boolean().optional(),
  shots: z.array(ShotSchema).max(15).optional(),
});

const PlanSchema = z.object({
  prompt: z.string().min(1).max(4000),
  seconds: z.number().int().min(1).max(SEQUENCE_CAP_SECONDS),
});

const IMAGE_TIMEOUT_MS = 90_000;
const VIDEO_START_TIMEOUT_MS = 90_000;

studioRoutes.post("/plan", requireUser, async (req, res) => {
  const body = PlanSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      code: "invalid_request",
      message: "Describe what to make first.",
    });
  }
  try {
    const shots = await planVideoShots(body.data.prompt, body.data.seconds);
    return res.json({
      seconds: shots.reduce((sum, s) => sum + s.seconds, 0),
      shots,
    });
  } catch (err) {
    console.warn(`[studio] plan failed: ${(err as Error).message}`);
    const shots = mergePlan(body.data.prompt, body.data.seconds, null);
    return res.json({
      seconds: shots.reduce((sum, s) => sum + s.seconds, 0),
      shots,
    });
  }
});

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
      shots: body.data.shots,
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
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
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
      shotIndex: job.shots.length ? job.shotIndex : undefined,
      shotCount: job.shots.length || undefined,
    });
  }

  if (job.status === "failed") {
    return res.json({
      status: "failed",
      message: job.error || "That clip could not be made.",
      jobId: job.id,
    });
  }

  const result = await advanceStudioJob(uid, job);
  return res.json(result);
});

async function startVideo(
  _req: express.Request,
  res: express.Response,
  opts: {
    uid: string;
    prompt: string;
    seconds: number;
    artifactId?: string;
    shots?: Array<{ prompt: string; seconds: number }>;
  },
) {
  const seconds = Math.max(1, Math.min(SEQUENCE_CAP_SECONDS, Math.floor(opts.seconds)));
  const shots = (opts.shots ?? []).filter((s) => s.prompt.trim() && s.seconds >= 1);

  // Confirmed plan: store the shots. The first GET starts Veo under a lock,
  // so a double-mounted poll cannot bill twice.
  if (shots.length > 0) {
    const job = await createStudioJob({
      uid: opts.uid,
      operation: "",
      model: "",
      prompt: opts.prompt,
      seconds: shots.reduce((sum, s) => sum + s.seconds, 0),
      artifactId: opts.artifactId,
      shots,
    });
    return res.json({
      status: "queued",
      message: RENDERING,
      jobId: job.id,
      shotIndex: 0,
      shotCount: shots.length,
    });
  }

  if (seconds > SHOT_MAX_SECONDS) {
    const job = await createStudioJob({
      uid: opts.uid,
      operation: "",
      model: "",
      prompt: opts.prompt,
      seconds,
      artifactId: opts.artifactId,
    });
    return res.json({
      status: "queued",
      message: RENDERING,
      jobId: job.id,
    });
  }

  try {
    const task = await runConnectorTool({
      uid: opts.uid,
      sessionId: STUDIO_SESSION_ID,
      connector: "media",
      tool: "draft_video",
      arguments: { prompt: opts.prompt, seconds },
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
      seconds,
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
