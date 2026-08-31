import express from "express";
import { z } from "zod";

import { authenticatingFetch } from "../a2a.js";
import { env } from "../env.js";
import { decideBotStart } from "../meetings/bot-start.js";
import { diarizeMix, meetSpaceFromUrl } from "../meetings/speaker.js";
import { readUsage } from "../repos/usage.js";

/**
 * Meetings, proxied to the scribe.
 *
 * Thin on purpose, exactly like the documents route. The scribe owns the tier
 * ladder, the meeting record and the commitment rules; this file owns knowing
 * which user is asking. Splitting it any other way would put a second copy of
 * the meeting logic on the internet-facing service.
 *
 * ## The uid is added here and never accepted here
 *
 * It comes from the verified session and travels as a header to an
 * internal-only service. A uid taken from a request body would let any caller
 * name any user, which is the whole reason this hop exists.
 */

const TIMEOUT_MS = 15_000;

export const meetingRoutes = express.Router();

function unavailable(res: express.Response): boolean {
  if (env.scribeUrl) return false;
  // Said plainly rather than as a 500. A deployment without a scribe is a
  // supported state, and "meetings are not available here" is actionable in a
  // way that "internal error" is not.
  res.status(503).json({
    code: "not_configured",
    message: "Meetings are not available in this environment.",
  });
  return true;
}

async function callScribe(
  uid: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const fetchImpl = authenticatingFetch(env.scribeUrl);
  return fetchImpl(`${env.scribeUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": uid,
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function relay(res: express.Response, upstream: Response): Promise<void> {
  const body = await upstream.text();
  if (upstream.ok) {
    res.status(upstream.status).type("application/json").send(body || "{}");
    return;
  }
  // Logged with the real status. Without this the route returned a bare 502 and
  // wrote nothing, so a permission error, a timeout and a crash all looked
  // identical from outside -- which is how a scribe that could not read
  // Firestore at all went unexplained while its container restarted cleanly.
  console.warn(`[meetings] scribe returned HTTP ${upstream.status}`);
  res.status(502).json({
    code: "upstream_error",
    message: "Meetings could not be reached.",
  });
}

meetingRoutes.get("/meetings", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(req.uid!, "/meetings");
      const body = await upstream.text();
      if (!upstream.ok) {
        console.warn(`[meetings] scribe returned HTTP ${upstream.status}`);
        res.status(502).json({ code: "upstream_error", message: "Meetings could not be reached." });
        return;
      }
      // Unwrapped to an array, because the client's schema is an array and the
      // scribe wraps it. Doing this here keeps the shape decision in one place.
      const parsed = JSON.parse(body || "{}") as { meetings?: unknown };
      res.json(parsed.meetings ?? []);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "Meetings could not be reached." });
    }
  })();
});

meetingRoutes.get("/meetings/:id/commitments", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/commitments`,
      );
      const body = await upstream.text();
      if (!upstream.ok) {
        console.warn(`[meetings] scribe returned HTTP ${upstream.status}`);
        res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
        return;
      }
      const parsed = JSON.parse(body || "{}") as { commitments?: unknown };
      res.json(parsed.commitments ?? []);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
    }
  })();
});

meetingRoutes.get("/settings/meetings", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(req.uid!, "/settings/meetings");
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be loaded." });
    }
  })();
});

meetingRoutes.post("/settings/meetings", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;

    const enabled = z.boolean().safeParse(req.body?.enabled);
    if (!enabled.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { enabled: boolean }." });
      return;
    }

    try {
      const upstream = await callScribe(req.uid!, "/settings/meetings", {
        method: "POST",
        body: JSON.stringify({ enabled: enabled.data }),
      });
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be saved." });
    }
  })();
});

meetingRoutes.post("/meetings/:id/opt-out", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;

    try {
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/opt-out`,
        { method: "POST", body: JSON.stringify({ optedOut: req.body?.optedOut ?? true }) },
      );
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be saved." });
    }
  })();
});

meetingRoutes.get("/meetings/:id/health", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/health`,
      );
      const body = await upstream.text();
      if (!upstream.ok) {
        console.warn(`[meetings] scribe returned HTTP ${upstream.status}`);
        res.status(502).json({ code: "upstream_error", message: "That could not be loaded." });
        return;
      }
      const parsed = JSON.parse(body || "{}") as { samples?: unknown };
      res.json(parsed.samples ?? []);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be loaded." });
    }
  })();
});

meetingRoutes.get("/meetings/:id/insights", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/insights`,
      );
      const body = await upstream.text();
      if (!upstream.ok) {
        console.warn(`[meetings] scribe returned HTTP ${upstream.status}`);
        res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
        return;
      }
      const parsed = JSON.parse(body || "{}") as { insights?: unknown };
      res.json(parsed.insights ?? []);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
    }
  })();
});

meetingRoutes.post("/meetings/:id/extend", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;

    const minutes = z.number().int().min(5).max(120).default(30).safeParse(req.body?.minutes ?? 30);
    if (!minutes.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected minutes." });
      return;
    }

    try {
      // Extending is always a person's decision. Nothing in this path may
      // extend a meeting on its own — that is the whole reason the cap exists.
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/extend`,
        { method: "POST", body: JSON.stringify({ minutes: minutes.data }) },
      );
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be extended." });
    }
  })();
});

const ConfirmSchema = z.object({ id: z.string().min(1).max(200) });

meetingRoutes.post("/meetings/:id/commitments/confirm", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;

    const body = ConfirmSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected { id: string }." });
      return;
    }

    try {
      // Confirmation is the moment a proposal becomes something that may act.
      // It goes to the scribe, which records it, and from there through the
      // same autonomy floor as every other action — never straight to a
      // connector from here.
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/commitments/confirm`,
        { method: "POST", body: JSON.stringify(body.data) },
      );
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not reach scribe: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "That could not be confirmed." });
    }
  })();
});

/**
 * Guest notetaker. Disclosure is the same boolean-true gate as tab capture.
 * There is no join client in this tree; a configured vendor key still cannot
 * knock until finance signs and a join module exists. We never log that key.
 */
const BotStartSchema = z.object({
  meetUrl: z.string().min(1).max(500),
  disclosed: z.unknown(),
  firstName: z.string().max(40).optional(),
  meetingId: z.string().max(200).optional(),
});

meetingRoutes.post("/meetings/bot", (req, res) => {
  void (async () => {
    const body = BotStartSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a Meet URL and a confirmation." });
      return;
    }

    const usage = await readUsage(req.uid!).catch(() => null);
    const decided = decideBotStart({
      disclosed: body.data.disclosed,
      meetUrl: body.data.meetUrl,
      tier: usage?.tier ?? "free",
      // A key without a join client would look like a bot is knocking.
      vendorConfigured: false,
      firstName: body.data.firstName,
    });

    if (!decided.ok && decided.code === "undisclosed") {
      res.status(403).json({ ok: false, code: decided.code, message: decided.message });
      return;
    }

    const space = decided.ok ? decided.space : (meetSpaceFromUrl(body.data.meetUrl) ?? "unknown");
    const meetingId = (body.data.meetingId || `bot-${space}`).slice(0, 128);

    if (unavailable(res)) return;

    try {
      await callScribe(req.uid!, "/meetings/bot", {
        method: "POST",
        body: JSON.stringify({
          meetingId,
          conferenceId: space,
          meetUrl: body.data.meetUrl,
          displayName: decided.ok ? decided.displayName : "AllTheWay notes",
          status: decided.ok ? "knocking" : decided.code === "vendor_pending" ? "vendor_pending" : "ended",
          reason: decided.ok ? "" : decided.message,
          disclosed: true,
        }),
      });
    } catch (err) {
      console.warn(`[meetings] could not record bot start: ${(err as Error).message}`);
    }

    if (!decided.ok) {
      res.json({
        ok: false,
        code: decided.code,
        message: decided.message,
        meetingId,
        status: decided.code === "vendor_pending" ? "vendor_pending" : decided.code,
      });
      return;
    }

    res.json({
      ok: true,
      meetingId,
      status: "knocking",
      displayName: decided.displayName,
      chatLine: decided.chatLine,
    });
  })();
});

meetingRoutes.post("/meetings/:id/diarize", (_req, res) => {
  // We do not store mixed PCM. Inventing Speaker 1–N from text is the
  // guessed-names path the ladder rejected.
  res.json(diarizeMix(null));
});

meetingRoutes.post("/meetings/:id/overlay-speakers", (req, res) => {
  void (async () => {
    if (unavailable(res)) return;
    try {
      const upstream = await callScribe(
        req.uid!,
        `/meetings/${encodeURIComponent(req.params.id)}/overlay-speakers`,
        {
          method: "POST",
          body: JSON.stringify({ conferenceId: req.body?.conferenceId }),
        },
      );
      await relay(res, upstream);
    } catch (err) {
      console.warn(`[meetings] could not overlay speakers: ${(err as Error).message}`);
      res.status(502).json({ code: "upstream_error", message: "Those names could not be loaded." });
    }
  })();
});
