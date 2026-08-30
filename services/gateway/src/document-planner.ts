import { PLANNER_SYSTEM } from "./document-cell-prompt.js";
import { PLANNER_MAX_TOKENS } from "./document-budget.js";
import { type DeckIr, parseDeck } from "./office-ir.js";
import { loadReferencePages } from "./document-references.js";
import { groupRetrievedDecks, loadCoherenceImages, retrieveSlideDesigns } from "./document-design-rag.js";
import { mimeOf, vertexJson } from "./document-vertex.js";

/**
 * Cell planner. Fresh call every turn. Never scores. Never talks to the person.
 */

export type PlannerInput = {
  brief: DeckIr;
  previous?: DeckIr;
  issues?: string[];
};

export type PlannerFn = (input: PlannerInput) => Promise<DeckIr>;

export async function vertexPlanner(input: PlannerInput): Promise<DeckIr> {
  const refs = await loadReferencePages();
  const neighbors = await retrieveSlideDesigns(queryFrom(input.brief), 3).catch(() => []);
  const parts: Array<Record<string, unknown>> = [];
  if (refs.length) {
    parts.push({
      text: `The next ${refs.length} image(s) are the quality bar. Plan a deck that could sit in the same folder.`,
    });
    for (const page of refs) {
      parts.push({ text: page.role });
      parts.push({ inlineData: { mimeType: mimeOf(page.bytes), data: page.bytes.toString("base64") } });
    }
  }
  if (neighbors.length) {
    const decks = groupRetrievedDecks(neighbors);
    parts.push({
      text:
        `Retrieved design graph from multimodal RAG (screenshot + coordinates + description). ` +
        `Each deck is one connected sequence. Copy placement grammar and slide-to-slide rhythm, not dummy copy.\n` +
        JSON.stringify(decks),
    });
    const images = await loadCoherenceImages(neighbors, 3).catch(() => []);
    for (const page of images) {
      parts.push({ text: page.role });
      parts.push({ inlineData: { mimeType: mimeOf(page.bytes), data: page.bytes.toString("base64") } });
    }
  }
  parts.push({
    text:
      `Story brief (do not copy a weak layout; place every box):\n${JSON.stringify(briefForModel(input.brief))}` +
      (input.previous
        ? `\n\nPrevious plan the worker rendered:\n${JSON.stringify(briefForModel(input.previous))}`
        : "") +
      (input.issues?.length ? `\n\nIndependent judge issues to fix:\n- ${input.issues.join("\n- ")}` : ""),
  });
  const raw = await planJson(parts);
  return parseDeck(raw as Record<string, unknown>);
}

function queryFrom(deck: DeckIr): string {
  const layouts = deck.slides.map((slide) => slide.layout).join(", ");
  const titles = deck.slides.map((slide) => slide.title ?? "").filter(Boolean).join("; ");
  return [
    `PowerPoint ${deck.title}`,
    deck.audience ? `for ${deck.audience}` : "",
    `layouts: ${layouts}`,
    titles,
    "Need designed slides: type hierarchy, photograph placement, and exact box coordinates.",
  ]
    .filter(Boolean)
    .join(". ");
}

async function planJson(parts: Array<Record<string, unknown>>): Promise<unknown> {
  try {
    return await vertexJson({
      system: PLANNER_SYSTEM,
      parts,
      temperature: 0.4,
      maxOutputTokens: PLANNER_MAX_TOKENS,
    });
  } catch (err) {
    const retryParts = [
      ...parts,
      { text: `Previous JSON was invalid (${(err as Error).message}). Emit minified deck.v1 only.` },
    ];
    return vertexJson({
      system: PLANNER_SYSTEM,
      parts: retryParts,
      temperature: 0.2,
      maxOutputTokens: PLANNER_MAX_TOKENS,
    });
  }
}

function briefForModel(deck: DeckIr): unknown {
  return {
    ir: deck.ir,
    title: deck.title,
    audience: deck.audience,
    date: deck.date,
    background: deck.background,
    slides: deck.slides.map((slide) => ({
      layout: slide.layout,
      title: slide.title,
      kicker: slide.kicker,
      subtitle: slide.subtitle,
      bullets: slide.bullets,
      cards: slide.cards,
      metrics: slide.metrics,
      asks: slide.asks,
      quote: slide.quote,
      image: slide.image,
      chart: slide.chart,
      background: slide.background,
      boxes: slide.boxes,
      shapes: slide.shapes,
      pictures: slide.pictures,
    })),
  };
}
