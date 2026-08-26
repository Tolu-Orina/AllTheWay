import express from "express";

import { env } from "../env.js";
import { requireUser } from "../auth.js";
import { authenticatingFetch } from "../a2a.js";

/**
 * The Agent Registry, as the browser sees it.
 *
 * A thin proxy, deliberately. The registry itself is internal-only like every
 * other backend service, and the gateway is the only thing the browser can
 * reach — so this is the seam, and it is kept dumb: authenticate the user,
 * forward, return what came back.
 *
 * Nothing is re-derived here. If the gateway recomputed trust, there would be
 * two implementations of "is this card trustworthy" and the one on this side
 * has no key. The registry decides; this carries the answer.
 */

export const registryRoutes = express.Router();

//: Long enough for three card fetches, short enough that a hung registry does
//: not hold a browser connection until Cloud Run gives up on it.
const TIMEOUT_MS = 15_000;

registryRoutes.get("/agents", requireUser, async (_req, res) => {
  if (!env.registryUrl) {
    return res.status(503).json({
      code: "not_configured",
      message: "The agent registry is not available in this environment.",
    });
  }

  try {
    // The same authenticated fetch the A2A clients use. The registry is
    // internal-only, so an unauthenticated call is rejected by Cloud Run
    // before it reaches the container.
    const fetchImpl = authenticatingFetch(env.registryUrl);
    const response = await fetchImpl(`${env.registryUrl}/agents`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[registry] upstream returned HTTP ${response.status}`);
      return res.status(502).json({
        code: "upstream_error",
        message: "The agent registry could not be read.",
      });
    }

    res.json(await response.json());
  } catch (err) {
    console.warn(`[registry] ${(err as Error).message}`);
    res.status(502).json({
      code: "upstream_error",
      message: "The agent registry could not be reached.",
    });
  }
});
