import { DOCUMENT_CELL_SYSTEM } from "./document-cell-prompt.js";
import { VISUAL_PASS_SCORE, type DeckIr, applyDeckPatch, structuralIssues } from "./office-ir.js";
import { CRITIC_MAX_TOKENS } from "./document-budget.js";
import { vertexProject } from "./document-images.js";
import { loadReferencePages } from "./document-references.js";

/**
 * Visual QA is a critic, not the designer. Structural checks always run.
 * Vision looks at LibreOffice screenshots of the compiled PPTX.
 */

export type Critique = {
  score: number;
  pass: boolean;
  issues: string[];
  irPatch?: unknown;
};

export type VisionFn = (pages: Buffer[], deck: DeckIr) => Promise<Critique>;

export function structuralCritique(deck: DeckIr): Critique {
  const issues = structuralIssues(deck);
  if (issues.length === 0) return { score: 100, pass: true, issues: [] };
  return { score: 0, pass: false, issues, irPatch: heuristicPatch(deck, issues) };
}

function heuristicPatch(deck: DeckIr, issues: string[]): unknown {
  const slides = deck.slides.map((slide) => ({
    ...slide,
    title: (slide.title ?? "").slice(0, 110),
    bullets: (slide.bullets ?? []).slice(0, 4),
    cards: (slide.cards ?? []).slice(0, 4),
    metrics: (slide.metrics ?? []).slice(0, 4),
  }));
  return { slides, note: issues.join("; ") };
}

export function normalizeCritique(raw: Partial<Critique> & { pass?: boolean; score?: unknown }): Critique {
  let score = Number(raw.score);
  if (!Number.isFinite(score)) {
    score = raw.pass ? 100 : 0;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    pass: score >= VISUAL_PASS_SCORE,
    issues: Array.isArray(raw.issues) ? raw.issues.map(String).slice(0, 12) : [],
    irPatch: raw.irPatch,
  };
}

export async function critiqueDeck(
  deck: DeckIr,
  pages: Buffer[],
  vision?: VisionFn,
): Promise<Critique> {
  const structural = structuralCritique(deck);
  if (!pages.length) {
    return normalizeCritique({
      score: 0,
      issues: ["visual QA has no page screenshots", ...structural.issues],
      irPatch: structural.irPatch,
    });
  }
  if (!vision) {
    return normalizeCritique({
      score: 0,
      issues: ["visual QA has no critic", ...structural.issues],
      irPatch: structural.irPatch,
    });
  }
  let visual: Critique;
  try {
    visual = normalizeCritique(await vision(pages, deck));
  } catch (err) {
    visual = {
      score: 0,
      pass: false,
      issues: [`visual QA request failed: ${(err as Error).message}`],
    };
  }
  if (!structural.pass) {
    return {
      score: Math.min(visual.score, 70),
      pass: false,
      issues: [...structural.issues, ...visual.issues],
      irPatch: visual.irPatch ?? structural.irPatch,
    };
  }
  return visual;
}

export function applyCritique(deck: DeckIr, critique: Critique): DeckIr {
  if (!critique.irPatch) return deck;
  return applyDeckPatch(deck, critique.irPatch);
}

export async function vertexVision(pages: Buffer[], deck: DeckIr): Promise<Critique> {
  const project = await vertexProject();
  if (!project || project === "alltheway-local") {
    return { score: 0, pass: false, issues: ["visual QA has no Vertex project"] };
  }
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  if (!token) return { score: 0, pass: false, issues: ["visual QA could not authenticate"] };
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const pictured = deck.slides.filter((s) => s.image?.kind === "generate" && s.image.prompt).length;
  const refs = await loadReferencePages();
  const parts: Array<Record<string, unknown>> = [];
  if (refs.length) {
    parts.push({
      text:
        `The next ${refs.length} image(s) are the quality bar (same archetypes every turn). ` +
        `Score our deck against that bar. 95 is “this could sit in the same folder.”`,
    });
    for (const page of refs) {
      parts.push({ text: page.role });
      parts.push({ inlineData: { mimeType: mimeOf(page.bytes), data: page.bytes.toString("base64") } });
    }
  }
  parts.push({
    text:
      `Our compiled deck follows. IR currently names ${pictured} generate slots. ` +
      `${pages.length} LibreOffice screenshots in slide order. ` +
      `Score 0–100. pass is true only if score >= ${VISUAL_PASS_SCORE}. ` +
      `Deck IR:\n${JSON.stringify({ title: deck.title, slides: deck.slides })}`,
  });
  for (const page of pages.slice(0, 12)) {
    parts.push({ inlineData: { mimeType: mimeOf(page), data: page.toString("base64") } });
  }
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/global/publishers/google/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DOCUMENT_CELL_SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: CRITIC_MAX_TOKENS,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok) {
    return { score: 0, pass: false, issues: [`visual QA request failed (${response.status})`] };
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (json.candidates ?? []).flatMap((c) => c.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { score: 0, pass: false, issues: ["visual QA returned no JSON"] };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Critique;
    return normalizeCritique(parsed);
  } catch {
    return { score: 0, pass: false, issues: ["visual QA returned invalid JSON"] };
  }
}

function mimeOf(page: Buffer): string {
  if (page.length >= 3 && page[0] === 0xff && page[1] === 0xd8 && page[2] === 0xff) return "image/jpeg";
  return "image/png";
}
