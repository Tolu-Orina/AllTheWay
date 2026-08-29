/**
 * One demanding Word brief: Gemini plans the body, the gateway renderer
 * designs the page. Not a Microsoft 365 connector.
 *
 *   npx tsx scripts/generate-board-pack.ts
 */
import { writeFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";

import { buildOfficeFile } from "../src/office-files.js";
import { previewBytes } from "../src/office-preview.js";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "alltheway-rinegan";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const OUT = process.env.OUT || "C:/Users/toluo/dev/AllTheWay/.local-artifacts/Q4-Launch-Board-Pack.docx";

const REQUEST = `Create a Word document for the Board: a full Q4 product launch pack, not a one-pager. Formal. Confidential. Audience is the Board. Write it as if the CEO is tabling it on 2 September 2026.

Include every section below as its own heading. Use specific numbers, named owners, and markdown tables wherever a bullet list would be lazy. Do not repeat the document title as a heading in the body.

1. Executive Summary — one paragraph, the decision needed today
2. Situation and strategic context
3. Product scope — what ships in Q4 vs what waits
4. Launch goals and success metrics — table: metric, baseline, Q4 target, owner
5. Go-to-market motion — sales, marketing, partnerships
6. 90-day milestone timeline — table: when, what, owner
7. Budget and unit economics — table with a total row
8. Risks and mitigations — table: risk, likelihood, impact, mitigation, owner
9. Competitive response
10. Hiring and customer-success coverage
11. Board asks — table: ask, amount or headcount, why now, if delayed
12. Decision requested and next review date`;

const SKILL = `You are AllTheWay's document planner. Return ONLY a JSON object of arguments for work_files.create_document.

Rules:
- title is the document title once. Short. Do not also start body with that same # heading.
- kind is "briefing". audience is "the Board".
- body is markdown: a short Executive Summary paragraph, then ## sections, | tables | for metrics/milestones/budget/risks/asks, and - **Label:** sentences where a table does not fit.
- Specific numbers, dates, named owners. Never lorem, TBD, or as needed.
- Do not mention that you are a model.`;

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

const raw = await generate(`${SKILL}\n\nThe user said:\n\n${REQUEST}`);
const args = parseJson(raw);
const built = await buildOfficeFile("create_document", args);
if ("error" in built) throw new Error(built.error);

await writeFile(OUT, built.body);
const preview = await previewBytes(built.mimeType, built.body);
const headings = (preview.paragraphs ?? []).filter((p) =>
  /executive|situation|scope|goal|metric|market|milestone|budget|risk|competitive|hiring|ask|decision/i.test(p),
);
console.log(`${OUT} (${built.body.length} bytes)  ${built.title}`);
console.log("kind", args.kind, "audience", args.audience);
console.log("preview hits", headings.slice(0, 40).join(" | "));
