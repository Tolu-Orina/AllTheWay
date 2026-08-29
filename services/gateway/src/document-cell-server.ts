/**
 * Document cell HTTP surface.
 *
 * JSON at `/compile`, discovery at `/.well-known/agent-card.json`.
 * Internal-only on Cloud Run — invoked by the gateway after Yes, never by
 * a browser, and never a second orchestrator. Trace lines are process
 * narration only (FR-10).
 */

import express from "express";

import { WALL_MS_WITH_IMAGES } from "./document-budget.js";
import { critiqueDeck, vertexVision } from "./document-critic.js";
import { generateStill } from "./document-images.js";
import { isLibreOfficeAvailable } from "./document-libreoffice.js";
import { runDocumentQuality } from "./document-quality.js";
import { MAX_CRITIQUE_ROUNDS, MAX_IMAGES, VISUAL_PASS_SCORE } from "./office-ir.js";

const PORT = Number(process.env.PORT ?? 8095);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

export const agentCard = {
  name: "AllTheWay Document Cell",
  description:
    "Compiles a deck.v1 or report.v1 into one Office file. Resolves planned image slots, screenshots the PPTX in LibreOffice, and runs visual QA until score >= 95 or 6 turns. Returns one artifact. Never talks to the person.",
  version: "1.3.0",
  protocolVersion: "0.3.0",
  url: PUBLIC_URL,
  skills: [
    {
      id: "compile_document",
      name: "Compile a document",
      description:
        "Validates layout IR, generates at least 3 Studio photographs, compiles templates, screenshots those slides in LibreOffice, and runs visual QA against the same eight archetype screenshots locally and in production. Visual QA is never skipped. Bounded in code: 240s without images, 360s with, 6 turns, pass at score >= 95. After 6 turns the last compile is persisted even if the score is still below 95.",
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
    res.json(agentCard);
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
      visualPassScore: VISUAL_PASS_SCORE,
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
