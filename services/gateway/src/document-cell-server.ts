/**
 * Document cell HTTP surface.
 *
 * JSON at `/compile`, discovery at `/.well-known/agent-card.json`.
 * Internal-only on Cloud Run — invoked by the gateway after Yes, never by
 * a browser, and never a second orchestrator. Trace lines are process
 * narration only (FR-10).
 */

import express from "express";

import { servedCard } from "./agent-card-sign.js";
import { WALL_MS_WITH_IMAGES } from "./document-budget.js";
import { critiqueDeck, vertexVision } from "./document-critic.js";
import { generateStill } from "./document-images.js";
import { isLibreOfficeAvailable } from "./document-libreoffice.js";
import { vertexPlanner } from "./document-planner.js";
import { runDocumentQuality } from "./document-quality.js";
import { MAX_CRITIQUE_ROUNDS, MAX_IMAGES, CONTENT_PASS_BAND, DESIGN_PASS_BAND } from "./office-ir.js";

const PORT = Number(process.env.PORT ?? 8095);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

export const agentCard = {
  name: "AllTheWay Document Cell",
  description:
    "After Yes: generate stills once, planner edits retrieved boxes, worker compiles, an independent judge scores Content and Design. Never talks to the person.",
  version: "1.5.0",
  protocolVersion: "0.3.0",
  url: PUBLIC_URL,
  skills: [
    {
      id: "compile_document",
      name: "Compile a document",
      description:
        "Planner writes layout, background, and coordinates. Worker generates planned stills once, compiles PPTX, screenshots in LibreOffice. Independent judge (fresh call, no rewrite) scores Content and Design 1–5. Bounded: 240s without images, 420s with, 3 turns, pass at Content ≥ 4 and Design ≥ 4.",
      tags: ["document", "slides", "bounded"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    },
  ],
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  capabilities: { streaming: false, pushNotifications: false },
};

async function compile(req: express.Request, res: express.Response): Promise<void> {
  const tool = typeof req.body?.tool === "string" ? req.body.tool : "";
  const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
  const imagesRemaining =
    req.body?.imagesRemaining === null || req.body?.imagesRemaining === undefined
      ? null
      : Number(req.body.imagesRemaining);
  try {
    const result = await runDocumentQuality({
      tool,
      args,
      imagesRemaining: Number.isFinite(imagesRemaining) ? imagesRemaining : null,
      generateImage: generateStill,
      planner: vertexPlanner,
      critic: async (deck, pages) => critiqueDeck(deck, pages, vertexVision),
    });
    res.json({
      title: result.title,
      mimeType: result.mimeType,
      body: result.body.toString("base64"),
      prompt: result.prompt,
      trace: result.trace,
      degraded: result.degraded,
      imagesGenerated: result.imagesGenerated,
      compiles: result.compiles,
      criticPassed: result.criticPassed,
      criticScore: result.criticScore,
      contentScore: result.contentScore,
      designScore: result.designScore,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export function createDocumentCellApp() {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.get("/healthz", health);
  app.get("/healthz/", health);
  app.get("/.well-known/agent-card.json", (_req, res) => {
    res.json(servedCard(agentCard as Record<string, unknown>));
  });
  app.post("/compile", (req, res) => {
    void compile(req, res);
  });
  return app;
}

function health(_req: express.Request, res: express.Response): void {
  res.json({
    ok: true,
    agent: agentCard.name,
    cardVersion: agentCard.version,
    budget: {
      critiqueRounds: MAX_CRITIQUE_ROUNDS,
      maxImages: MAX_IMAGES,
      wallClockS: WALL_MS_WITH_IMAGES / 1000,
      contentPass: CONTENT_PASS_BAND,
      designPass: DESIGN_PASS_BAND,
      libreOffice: isLibreOfficeAvailable(),
    },
  });
}

if (process.argv[1] && /document-cell-server/.test(process.argv[1])) {
  const app = createDocumentCellApp();
  app.listen(PORT, () => {
    console.log(`[document-cell] ${PUBLIC_URL}  port ${PORT}`);
  });
}
