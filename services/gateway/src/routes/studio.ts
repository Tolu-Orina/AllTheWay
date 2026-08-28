import express from "express";
import { z } from "zod";

import { env } from "../env.js";
import { requireUser } from "../auth.js";
import { runConnectorTool, readableDetail } from "../act.js";
import {
  persistGeneratedMedia,
  STUDIO_SESSION_ID,
} from "../media-persist.js";

/**
 * Studio Generate is consent.
 *
 * The companion asks Yes because it inferred a request. Here they typed the
 * prompt and pressed the button — that is the yes. The floor still receives
 * `confirmed: true`. The UI must not ask twice.
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

const VIDEO_WAIT =
  "Drafting a clip can take several minutes, longer than this page can wait. Nothing was charged.";

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

  if (mode === "video") {
    return res.json({ status: "not_ready", message: VIDEO_WAIT });
  }

  if (!env.connectorGatewayUrl) {
    return res.status(503).json({
      code: "not_configured",
      message: "Image generation is not available in this environment.",
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
