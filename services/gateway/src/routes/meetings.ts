import express from "express";
import { z } from "zod";

import { authenticatingFetch } from "../a2a.js";
import { env } from "../env.js";

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
        res.status(502).json({ code: "upstream_error", message: "Meetings could not be reached." });
        return;
      }
      // Unwrapped to an array, because the client's schema is an array and the
      // scribe wraps it. Doing this here keeps the shape decision in one place.
      const parsed = JSON.parse(body || "{}") as { meetings?: unknown };
      res.json(parsed.meetings ?? []);
    } catch {
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
        res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
        return;
      }
      const parsed = JSON.parse(body || "{}") as { commitments?: unknown };
      res.json(parsed.commitments ?? []);
    } catch {
      res.status(502).json({ code: "upstream_error", message: "Those could not be loaded." });
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
    } catch {
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
    } catch {
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
        res.status(502).json({ code: "upstream_error", message: "That could not be loaded." });
        return;
      }
      const parsed = JSON.parse(body || "{}") as { samples?: unknown };
      res.json(parsed.samples ?? []);
    } catch {
      res.status(502).json({ code: "upstream_error", message: "That could not be loaded." });
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
    } catch {
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
    } catch {
      res.status(502).json({ code: "upstream_error", message: "That could not be confirmed." });
    }
  })();
});
