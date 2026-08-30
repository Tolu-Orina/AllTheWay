import { PLANNER_SYSTEM } from "./document-cell-prompt.js";
import { PLANNER_MAX_TOKENS } from "./document-budget.js";
import {
  SLIDE_H,
  SLIDE_W,
  applyDeckEdits,
  isTextRole,
  parseDeck,
  type DeckIr,
  type SlideIr,
  type TextBox,
} from "./office-ir.js";
import { loadReferencePages } from "./document-references.js";
import {
  groupRetrievedDecks,
  loadCoherenceImages,
  retrieveSlideDesigns,
  rerankBySlotSchema,
  schemaScore,
  slotSchemaOfNode,
  slotSchemaOfSlide,
} from "./document-design-rag.js";
import { mimeOf, vertexJson } from "./document-vertex.js";
import type { StillMeta } from "./document-images.js";
import type { SlideDesignNode } from "./document-design.js";

/**
 * Cell planner. Fresh call every turn. Never scores. Never talks to the person.
 */

export type PlannerInput = {
  brief: DeckIr;
  previous?: DeckIr;
  issues?: string[];
  stills?: StillMeta[];
  editMode?: boolean;
  startingIr?: DeckIr;
};

export type PlannerFn = (input: PlannerInput) => Promise<DeckIr>;

export async function vertexPlanner(input: PlannerInput): Promise<DeckIr> {
  const refs = await loadReferencePages();
  const neighbors = await retrieveSlideDesigns(queryFrom(input.brief), 8, input.brief).catch(
    () => [] as SlideDesignNode[],
  );
  const starting = input.startingIr ?? startingIrFromRetrieved(input.brief, neighbors);
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
        `Each deck is one connected sequence. Copy placement grammar and slide-to-slide rhythm, not dummy copy. ` +
        `These screenshots are the thing being edited, not a moodboard.\n` +
        JSON.stringify(decks),
    });
    const images = await loadCoherenceImages(neighbors, 3).catch(() => []);
    for (const page of images) {
      parts.push({ text: page.role });
      parts.push({ inlineData: { mimeType: mimeOf(page.bytes), data: page.bytes.toString("base64") } });
    }
  }
  if (starting) {
    parts.push({
      text: `Starting IR (edit these boxes; retrieved geometry with this story’s copy):\n${JSON.stringify(briefForModel(starting))}`,
    });
  } else if (neighbors.length) {
    parts.push({ text: "Retrieved slot schema did not match this brief; emit a full deck.v1." });
  }
  if (input.stills?.length) {
    parts.push({
      text: `Generated stills (already on disk; place boxes around these pixels):\n${JSON.stringify(input.stills)}`,
    });
  }
  const mode = input.editMode || Boolean(input.previous && input.issues?.length);
  parts.push({
    text:
      (mode ? "EDIT MODE. Previous IR + named issues. Prefer edits[] on element ids. " : "") +
      `Story brief (do not copy a weak layout; place every box):\n${JSON.stringify(briefForModel(input.brief))}` +
      (input.previous
        ? `\n\nPrevious plan the worker rendered:\n${JSON.stringify(briefForModel(input.previous))}`
        : "") +
      (input.issues?.length ? `\n\nIndependent judge or validator issues to fix:\n- ${input.issues.join("\n- ")}` : ""),
  });
  const raw = await planJson(parts);
  return parsePlannerOutput(raw, input.previous ?? starting);
}

export function startingIrFromRetrieved(brief: DeckIr, nodes: SlideDesignNode[]): DeckIr | undefined {
  if (!nodes.length) return undefined;
  const ranked = rerankBySlotSchema(nodes, brief);
  const used = new Set<string>();
  let matched = 0;
  const slides = brief.slides.map((slide, i) => {
    const want = slotSchemaOfSlide(slide);
    let best: SlideDesignNode | undefined;
    let bestScore = -1;
    for (const node of ranked) {
      if (used.has(node.id)) continue;
      const score = schemaScore(want, slotSchemaOfNode(node));
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    if (!best || bestScore < 3) return slide;
    used.add(best.id);
    matched += 1;
    return applyNodeGeometry(slide, best, i);
  });
  if (!matched) return undefined;
  return parseDeck({ ...brief, slides } as unknown as Record<string, unknown>);
}

function applyNodeGeometry(slide: SlideIr, node: SlideDesignNode, index: number): SlideIr {
  if (node.layout !== slide.layout) return slide;
  const scaleX = SLIDE_W / (node.width || SLIDE_W);
  const scaleY = SLIDE_H / (node.height || SLIDE_H);
  const boxes: TextBox[] = (node.description.boxes ?? []).map((box, j) => {
    const role = isTextRole(box.role) ? box.role : "body";
    let text = box.text;
    if (role === "title") text = slide.title || box.text;
    else if (role === "subtitle") text = slide.subtitle || slide.kicker || box.text;
    else if (role === "kicker") text = slide.kicker || box.text;
    else if (role === "body" && slide.bullets?.length) text = slide.bullets.join("\n");
    return {
      id: `s${index}-${role}-${j}`,
      role,
      text,
      x: box.x * scaleX,
      y: box.y * scaleY,
      w: box.w * scaleX,
      h: box.h * scaleY,
      fontSize: box.fontSize,
    };
  });
  const pictures = (node.description.images ?? []).map((img, j) => ({
    id: `s${index}-pic-${j}`,
    prompt: slide.image?.prompt?.trim() || img.what || "editorial photograph, no text",
    role: img.kind === "background" ? ("background" as const) : ("picture" as const),
    x: img.x * scaleX,
    y: img.y * scaleY,
    w: img.w * scaleX,
    h: img.h * scaleY,
  }));
  return {
    ...slide,
    boxes: boxes.length ? boxes : slide.boxes,
    pictures: pictures.length ? pictures : slide.pictures,
    background: node.description.background.fill
      ? { fill: node.description.background.fill, image: slide.background?.image }
      : slide.background,
  };
}

export function parsePlannerOutput(raw: unknown, fallback?: DeckIr): DeckIr {
  if (!raw || typeof raw !== "object") {
    return parseDeck(
      (fallback ?? { ir: "deck.v1", title: "Presentation", slides: [] }) as unknown as Record<string, unknown>,
    );
  }
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.edits) && fallback) {
    const base =
      rec.ir === "deck.v1" && Array.isArray(rec.slides) ? parseDeck(rec as Record<string, unknown>) : fallback;
    return applyDeckEdits(base, rec.edits);
  }
  return parseDeck(rec);
}

function queryFrom(deck: DeckIr): string {
  const layouts = deck.slides.map((slide) => slide.layout).join(", ");
  const titles = deck.slides.map((slide) => slide.title ?? "").filter(Boolean).join("; ");
  const schema = deck.slides.map((slide) => {
    const s = slotSchemaOfSlide(slide);
    return `${s.layout} t${s.titles} b${s.bodies} p${s.pictures} c${s.charts} n${s.numbers}`;
  });
  return [
    `PowerPoint ${deck.title}`,
    deck.audience ? `for ${deck.audience}` : "",
    `layouts: ${layouts}`,
    `slot schema: ${schema.join(" | ")}`,
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
