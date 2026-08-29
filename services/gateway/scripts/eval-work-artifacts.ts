/**
 * Quality check for Work file generation against gemini-3.7-flash.
 *
 * The model writes the same tool arguments the orchestrator would, we build
 * real .md / .docx / .xlsx / .pptx, then the same model scores the result.
 * Decks are scored from page rasters of the IR, not previewBytes text.
 *
 *   npx tsx scripts/eval-work-artifacts.ts
 */
import { GoogleAuth } from "google-auth-library";

import { rasterDeck } from "../src/document-raster.js";
import { parseDeck } from "../src/office-ir.js";
import { buildOfficeFile } from "../src/office-files.js";
import { previewBytes } from "../src/office-preview.js";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "alltheway-rinegan";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

type Job = {
  id: string;
  tool: "create_markdown" | "create_document" | "create_spreadsheet" | "create_slides";
  request: string;
};

const JOBS: Job[] = [
  {
    id: "markdown",
    tool: "create_markdown",
    request:
      "Write a markdown briefing I can keep here for the Q4 product launch. Audience is the exec team. Include goals, risks, and the next two weeks.",
  },
  {
    id: "word",
    tool: "create_document",
    request:
      "Create a Word document briefing the Q4 launch for the board. Formal, headings, bullets for risks and asks.",
  },
  {
    id: "sheet",
    tool: "create_spreadsheet",
    request:
      "Create a spreadsheet of the Q4 launch budget. Columns for item, owner, amount, status. Include ads, events, contractors, and a total row.",
  },
  {
    id: "slides",
    tool: "create_slides",
    request:
      "Create a 5-slide PowerPoint for the Q4 launch review: where we are, pipeline, risks, next steps, ask. Use deck.v1 layouts including a metric-row and a chart.",
  },
];

type Part = Record<string, unknown>;

async function generate(parts: Part[], maxOutputTokens = 8000): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("no ADC token");

  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${PROJECT}` +
      `/locations/global/publishers/google/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Vertex ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (json.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no JSON in: ${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

async function main() {
  console.log(`model ${MODEL}  project ${PROJECT}\n`);
  const artefacts: Array<{ id: string; tool: string; preview: unknown; bytes: number; pages?: number }> = [];
  const slidePages: Array<{ id: string; pages: Buffer[] }> = [];

  for (const job of JOBS) {
    const prompt =
      `You are AllTheWay's work planner. The user said:\n\n${job.request}\n\n` +
      `Return ONLY a JSON object of arguments for work_files.${job.tool}. ` +
      `Put the full useful content in the arguments so Yes can write a real file. ` +
      `For create_markdown / create_document: {title, body} or report.v1 {ir, title, sections}. ` +
      `For create_spreadsheet: {title, headers, rows} where rows is an array of arrays. ` +
      `For create_slides: deck.v1 {ir:"deck.v1", title, audience, slides:[{layout, ...}]}. ` +
      `Do not mention that you are a model.`;

    const raw = await generate([{ text: prompt }]);
    const args = parseJson(raw);
    const built = await buildOfficeFile(job.tool, args);
    if ("error" in built) {
      console.log(`FAIL  ${job.id}: ${built.error}`);
      continue;
    }
    const preview = await previewBytes(built.mimeType, built.body);
    if (job.tool === "create_slides") {
      const pages = rasterDeck(parseDeck(args));
      slidePages.push({ id: job.id, pages });
      artefacts.push({
        id: job.id,
        tool: job.tool,
        preview: { format: "slides", pageCount: pages.length, ir: args },
        bytes: built.body.length,
        pages: pages.length,
      });
    } else {
      artefacts.push({
        id: job.id,
        tool: job.tool,
        preview,
        bytes: built.body.length,
      });
    }
    console.log(`built ${job.id}  ${built.mimeType}  ${built.body.length} bytes  ${built.title}`);
  }

  const scoreParts: Part[] = [
    {
      text:
        "You are reviewing files AllTheWay just generated for a Q4 launch. " +
        "Score each artefact 1-10 on: structure, usefulness to an exec, and whether " +
        "it looks like a real deliverable rather than a stub. Be blunt. " +
        "For slides, score the page images (overlap, overflow, empty, too much text), not the JSON. " +
        "Return JSON: {items:[{id, structure, usefulness, realness, notes}], verdict}.\n\n" +
        JSON.stringify(artefacts, null, 2),
    },
  ];
  for (const pack of slidePages) {
    for (const [i, page] of pack.pages.entries()) {
      scoreParts.push({ text: `${pack.id} page ${i + 1}` });
      scoreParts.push({ inlineData: { mimeType: "image/png", data: page.toString("base64") } });
    }
  }

  const scored = await generate(scoreParts);
  console.log("\n--- gemini-3.7-flash review ---\n");
  console.log(scored);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
