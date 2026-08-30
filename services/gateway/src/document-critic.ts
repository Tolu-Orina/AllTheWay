/**
 * Independent judge. Scores LibreOffice screenshots for Content and Design.
 * Cannot rewrite the plan. Structure is the validator, not this model.
 */

import { JUDGE_SYSTEM } from "./document-cell-prompt.js";
import { CONTENT_PASS_BAND, DESIGN_PASS_BAND, type DeckIr } from "./office-ir.js";
import { CRITIC_MAX_TOKENS } from "./document-budget.js";
import { loadReferencePages } from "./document-references.js";
import { mimeOf, vertexJson } from "./document-vertex.js";

export type TaggedIssue = {
  dimension: "content" | "design" | "structure";
  slideIndex?: number;
  elementId?: string;
  note: string;
};

export type Critique = {
  content: number;
  design: number;
  score: number;
  pass: boolean;
  issues: string[];
  tagged: TaggedIssue[];
};

export type VisionFn = (pages: Buffer[], deck: DeckIr) => Promise<Partial<Critique>>;

export function bandPass(content: number, design: number): boolean {
  return content >= CONTENT_PASS_BAND && design >= DESIGN_PASS_BAND;
}

export function normalizeCritique(
  raw: Partial<Critique> & { pass?: boolean; score?: unknown; content?: unknown; design?: unknown; issues?: unknown },
): Critique {
  const tagged = taggedFrom(raw);
  const issues = tagged.length
    ? tagged.map((item) => item.note)
    : Array.isArray(raw.issues)
      ? raw.issues.map(String).slice(0, 12)
      : [];
  const taggedOut = tagged.length ? tagged : issues.map((note) => ({ dimension: "design" as const, note }));
  let content = bandOf(raw.content);
  let design = bandOf(raw.design);
  if (!content && !design) {
    const score = Number(raw.score);
    if (Number.isFinite(score)) {
      content = bandFromHundred(score);
      design = content;
    } else if (raw.pass === true) {
      content = 5;
      design = 5;
    } else {
      return { content: 0, design: 0, score: 0, pass: false, issues, tagged: taggedOut };
    }
  }
  if (!content) content = 1;
  if (!design) design = 1;
  return {
    content,
    design,
    score: Math.round(((content + design) / 2) * 20),
    pass: bandPass(content, design),
    issues,
    tagged: taggedOut,
  };
}

export async function critiqueDeck(
  deck: DeckIr,
  pages: Buffer[],
  vision?: VisionFn,
): Promise<Critique> {
  if (!pages.length) {
    return normalizeCritique({
      content: 1,
      design: 1,
      issues: ["visual QA has no page screenshots"],
    });
  }
  if (!vision) {
    return normalizeCritique({
      content: 1,
      design: 1,
      issues: ["visual QA has no judge"],
    });
  }
  try {
    return normalizeCritique(await vision(pages, deck));
  } catch (err) {
    return {
      content: 1,
      design: 1,
      score: 0,
      pass: false,
      issues: [`visual QA request failed: ${(err as Error).message}`],
      tagged: [{ dimension: "design", note: `visual QA request failed: ${(err as Error).message}` }],
    };
  }
}

export async function vertexVision(pages: Buffer[], deck: DeckIr): Promise<Critique> {
  const refs = await loadReferencePages();
  const parts: Array<Record<string, unknown>> = [];
  if (refs.length) {
    parts.push({
      text:
        `The next ${refs.length} image(s) are the quality bar (same archetypes every turn). ` +
        `Describe then score Content and Design 1–5. Structure (overlap, overflow) is already gated in code.`,
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
      `Return {content:1-5, design:1-5, issues:[{dimension, slideIndex, elementId, note}]}. ` +
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
    model: process.env.GEMINI_JUDGE_MODEL || undefined,
  })) as Partial<Critique>;
  return normalizeCritique(parsed);
}

function bandOf(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function bandFromHundred(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return Math.max(1, Math.min(5, Math.round(clamped / 20) || 1));
}

function taggedFrom(raw: { issues?: unknown; tagged?: unknown }): TaggedIssue[] {
  const listed = Array.isArray(raw.tagged) ? raw.tagged : Array.isArray(raw.issues) ? raw.issues : [];
  const out: TaggedIssue[] = [];
  for (const item of listed) {
    if (typeof item === "string") {
      out.push({ dimension: "design", note: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const note = String(rec.note ?? rec.message ?? rec.issue ?? "").trim();
    if (!note) continue;
    const dimension = rec.dimension === "content" || rec.dimension === "structure" ? rec.dimension : "design";
    const slideIndex = Number(rec.slideIndex);
    out.push({
      dimension,
      slideIndex: Number.isInteger(slideIndex) ? slideIndex : undefined,
      elementId: typeof rec.elementId === "string" ? rec.elementId : undefined,
      note,
    });
  }
  return out.slice(0, 12);
}
