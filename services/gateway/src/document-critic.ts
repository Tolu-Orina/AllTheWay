import { JUDGE_SYSTEM } from "./document-cell-prompt.js";
import { VISUAL_PASS_SCORE, type DeckIr, structuralIssues } from "./office-ir.js";
import { CRITIC_MAX_TOKENS } from "./document-budget.js";
import { loadReferencePages } from "./document-references.js";
import { mimeOf, vertexJson } from "./document-vertex.js";

/**
 * Independent judge. Scores LibreOffice screenshots. Cannot rewrite the plan.
 */

export type Critique = {
  score: number;
  pass: boolean;
  issues: string[];
};

export type VisionFn = (pages: Buffer[], deck: DeckIr) => Promise<Critique>;

export function structuralCritique(deck: DeckIr): Critique {
  const issues = structuralIssues(deck);
  if (issues.length === 0) return { score: 100, pass: true, issues: [] };
  return { score: 0, pass: false, issues };
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
    });
  }
  if (!vision) {
    return normalizeCritique({
      score: 0,
      issues: ["visual QA has no judge", ...structural.issues],
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
    };
  }
  return visual;
}

export async function vertexVision(pages: Buffer[], deck: DeckIr): Promise<Critique> {
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
      `The worker rendered this plan. You did not write it. Score the screenshots only. ` +
      `${pages.length} LibreOffice screenshots in slide order. ` +
      `Score 0–100. Return {score, issues}. ` +
      `Plan:\n${JSON.stringify({ title: deck.title, background: deck.background, slides: deck.slides })}`,
  });
  for (const page of pages.slice(0, 12)) {
    parts.push({ inlineData: { mimeType: mimeOf(page), data: page.toString("base64") } });
  }
  const parsed = (await vertexJson({
    system: JUDGE_SYSTEM,
    parts,
    temperature: 0.1,
    maxOutputTokens: CRITIC_MAX_TOKENS,
  })) as Critique;
  return normalizeCritique(parsed);
}
