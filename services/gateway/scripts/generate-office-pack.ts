/**
 * Generate designed PPT, PDF, and spreadsheet samples via Gemini 3.7 Flash.
 *
 *   npx tsx scripts/generate-office-pack.ts
 */
import { writeFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";

import { buildOfficeFile } from "../src/office-files.js";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "alltheway-rinegan";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const DIR = "C:/Users/toluo/dev/AllTheWay/.local-artifacts";

const JOBS = [
  {
    tool: "create_slides" as const,
    out: `${DIR}/Q4-Launch-Review.pptx`,
    request: `Create a 7-slide PowerPoint for the Board Q4 product launch review. Formal. Confidential.
Slides must cover: where we are, product scope, goals and metrics, GTM, 90-day timeline, risks, and the board ask.
At most five short bullets per slide. Specific numbers, named owners. Do not repeat the deck title as a content slide.`,
    skill: `Return ONLY JSON for work_files.create_slides as deck.v1:
{ir:"deck.v1", title, audience, slides:[{layout, title, bullets?, cards?, metrics?, chart?, image?, asks?}]}.
audience is "the Board". Layouts: title, two-card, metric-row, split-visual, chart, closing-ask, bullets.
Native chart when there are numbers. Image kind generate only where a visual carries the point. No lorem.`,
  },
  {
    tool: "create_pdf" as const,
    out: `${DIR}/Q4-Launch-Pack.pdf`,
    request: `Create a PDF for the Board: Q4 product launch pack. Formal. Confidential. CEO tables it on 2 September 2026.
Sections: Executive Summary, situation, product scope (table: in vs deferred), goals (table: metric, baseline, target, owner), GTM, 90-day timeline table, budget with a total, risks table, board asks table, decision requested.
Specific numbers and named owners. Do not repeat the title as a heading in the body.`,
    skill: `Return ONLY JSON for work_files.create_pdf: {title, kind, audience, body}.
kind is "briefing". audience is "the Board". body is markdown with ## sections and | tables |. Title once. No lorem.`,
  },
  {
    tool: "create_spreadsheet" as const,
    out: `${DIR}/Q4-Launch-Budget.xlsx`,
    request: `Create a spreadsheet of the Q4 launch budget for the Board. Columns: Item, Owner, Amount, Status.
Rows for ads, events, contractors, sales enablement, customer success coverage, contingency. Amounts in GBP. Include a Total row.`,
    skill: `Return ONLY JSON for work_files.create_spreadsheet: {title, headers, rows}.
rows is an array of arrays. Amounts as numbers, not strings. Include a Total row.`,
  },
];

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function generate(prompt: string): Promise<string> {
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
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8000 },
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
  if (start < 0 || end < start) throw new Error(`no JSON in: ${text.slice(0, 240)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

for (const job of JOBS) {
  const raw = await generate(`${job.skill}\n\nThe user said:\n\n${job.request}`);
  const args = parseJson(raw);
  const built = await buildOfficeFile(job.tool, args);
  if ("error" in built) throw new Error(`${job.tool}: ${built.error}`);
  await writeFile(job.out, built.body);
  console.log(`${job.out}  ${built.body.length} bytes  ${built.title}`);
}
