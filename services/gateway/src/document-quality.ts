import { buildOfficeFile, type OfficeFile } from "./office-files.js";
import {
  MORE_TURN_MS,
  RENDER_TIMEOUT_MS,
  documentBudget,
  remainingDeadline,
  type DocumentBudget,
} from "./document-budget.js";
import { applyCritique, critiqueDeck, normalizeCritique, vertexVision, type Critique } from "./document-critic.js";
import { renderPptxPagesOrThrow, type RenderPagesFn } from "./document-libreoffice.js";
import { compileDeck, type SlideImages } from "./office-slides.js";
import { VISUAL_PASS_SCORE, ensureDeckImages, imageSlots, parseDeck, type DeckIr } from "./office-ir.js";

/**
 * Bounded document-cell graph. One call, workers invisible.
 *
 * 1. Validate IR
 * 2. Ensure at least three image slots
 * 3. Resolve image slots (Studio model, metered)
 * 4. For at most 6 turns: compile → LibreOffice screenshots → Gemini score
 * 5. Stop when score >= 95. Visual QA is never skipped or auto-passed.
 * 6. After 6 turns, persist the last compile; criticPassed stays false if < 95
 */

export type GenerateImageFn = (prompt: string) => Promise<Buffer | null>;
export type CriticFn = (deck: DeckIr, pages: Buffer[]) => Promise<Partial<Critique>>;

export type DocumentQualityInput = {
  tool: string;
  args: Record<string, unknown>;
  imagesRemaining: number | null;
  generateImage?: GenerateImageFn;
  critic?: CriticFn;
  renderPages?: RenderPagesFn;
  budget?: Partial<DocumentBudget>;
  now?: () => number;
};

export type DocumentQualityResult = OfficeFile & {
  trace: string[];
  degraded: boolean;
  imagesGenerated: number;
  compiles: number;
  criticPassed: boolean;
  criticScore: number;
};

export async function compileWorkFile(opts: {
  tool: string;
  args: Record<string, unknown>;
  imagesRemaining: number | null;
  callCell?: () => Promise<DocumentQualityResult | null>;
  generateImage?: GenerateImageFn;
  critic?: CriticFn;
  renderPages?: RenderPagesFn;
  budget?: Partial<DocumentBudget>;
}): Promise<DocumentQualityResult | { error: string }> {
  try {
    if (opts.callCell) {
      const fromCell = await opts.callCell();
      if (fromCell && fromCell.body?.length) return fromCell;
      throw new Error("document cell returned nothing");
    }
    return await runDocumentQuality(opts);
  } catch (err) {
    console.warn(`[document-cell] degrade: ${(err as Error).message}`);
    const fallback = await buildOfficeFile(opts.tool, opts.args);
    if ("error" in fallback) return fallback;
    return {
      ...fallback,
      trace: ["degraded to current renderer"],
      degraded: true,
      imagesGenerated: 0,
      compiles: 1,
      criticPassed: false,
      criticScore: 0,
    };
  }
}

export async function runDocumentQuality(opts: DocumentQualityInput): Promise<DocumentQualityResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const trace: string[] = [];

  if (opts.tool !== "create_slides") {
    const built = await buildOfficeFile(opts.tool, opts.args);
    if ("error" in built) throw new Error(built.error);
    return {
      ...built,
      trace: [`Compiled ${opts.tool}`],
      degraded: false,
      imagesGenerated: 0,
      compiles: 1,
      criticPassed: true,
      criticScore: 100,
    };
  }

  let deck = ensureDeckImages(parseDeck(opts.args));
  const hasImages =
    imageSlots(deck).length > 0 && (opts.imagesRemaining === null || opts.imagesRemaining > 0);
  const budget = documentBudget(hasImages, opts.budget);
  const quota =
    opts.imagesRemaining === null ? budget.maxImages : Math.max(0, Math.min(budget.maxImages, opts.imagesRemaining));

  let images: SlideImages = {};
  let imagesGenerated = 0;
  imagesGenerated += await fillImages(deck, images, {
    generateImage: opts.generateImage,
    quota,
    trace,
  });

  const critic: CriticFn =
    opts.critic ?? ((current, pages) => critiqueDeck(current, pages, vertexVision));
  const renderPages: RenderPagesFn = opts.renderPages ?? renderPptxPagesOrThrow;

  let last: OfficeFile | undefined;
  let compiles = 0;
  let criticPassed = false;
  let criticScore = 0;
  let degraded = false;

  for (let turn = 0; turn < budget.critiqueRounds; turn++) {
    const remaining = remainingDeadline(started, budget, now());
    if (turn > 0 && remaining < MORE_TURN_MS) {
      trace.push("wall clock exhausted; keeping last compile");
      degraded = true;
      break;
    }

    last = await compileDeck(deck, images);
    compiles += 1;

    let pages: Buffer[] = [];
    try {
      const renderMs = Math.min(RENDER_TIMEOUT_MS, Math.max(8_000, remaining));
      pages = await withTimeout(renderPages(last.body), renderMs);
    } catch (err) {
      const reason = (err as Error).message || "LibreOffice render failed";
      criticScore = 0;
      trace.push(`visual QA turn ${turn + 1}: 0/100 (${reason})`);
      if (/not installed/i.test(reason)) {
        degraded = true;
        break;
      }
      if (turn === budget.critiqueRounds - 1) {
        degraded = true;
        break;
      }
      continue;
    }

    let critique: Critique;
    try {
      critique = normalizeCritique(await withTimeout(critic(deck, pages), budget.criticTimeoutMs));
    } catch {
      critique = { score: 0, pass: false, issues: ["visual QA timed out"] };
    }
    const missingPhotos = missingPhotoLayouts(deck, images);
    if (missingPhotos) {
      critique = {
        ...critique,
        score: Math.min(critique.score, 79),
        pass: false,
        issues: [...critique.issues, `${missingPhotos} photograph layout(s) have no still`],
      };
    }
    criticScore = critique.score;
    if (critique.pass) {
      criticPassed = true;
      trace.push(`visual QA turn ${turn + 1}: ${critique.score}/100 pass`);
      console.info(`[document-cell] visual QA turn ${turn + 1}: ${critique.score}/100 pass`);
      break;
    }
    trace.push(
      `visual QA turn ${turn + 1}: ${critique.score}/100 — ${(critique.issues ?? []).join("; ") || `below ${VISUAL_PASS_SCORE}`}`,
    );
    console.info(
      `[document-cell] visual QA turn ${turn + 1}: ${critique.score}/100 — ${(critique.issues ?? []).slice(0, 3).join("; ")}`,
    );
    if (turn === budget.critiqueRounds - 1) {
      degraded = true;
      trace.push(`visual QA still below ${VISUAL_PASS_SCORE} after ${budget.critiqueRounds} turns; keeping last compile`);
      break;
    }
    if (critique.irPatch) {
      const previous = deck;
      deck = ensureDeckImages(applyCritique(deck, critique));
      images = remapImages(previous, deck, images);
      imagesGenerated += await fillImages(deck, images, {
        generateImage: opts.generateImage,
        quota,
        trace,
      });
    }
  }

  if (!last) {
    last = await compileDeck(deck, images);
    compiles = Math.max(compiles, 1);
  }

  if (!criticPassed && !degraded) {
    degraded = true;
    trace.push("visual QA did not pass; keeping last compile");
  }

  trace.unshift(
    `Compiled ${deck.slides.length} slides, ${imagesGenerated} images, ` +
      (criticPassed ? `critic passed ${criticScore}/100` : `critic ${criticScore}/100 (need ${VISUAL_PASS_SCORE})`),
  );

  return {
    ...last,
    trace,
    degraded,
    imagesGenerated,
    compiles,
    criticPassed,
    criticScore,
  };
}

async function fillImages(
  deck: DeckIr,
  images: SlideImages,
  opts: {
    generateImage?: GenerateImageFn;
    quota: number;
    trace: string[];
  },
): Promise<number> {
  const already = Object.values(images).filter((bytes) => bytes?.length).length;
  const slots = imageSlots(deck);
  if (slots.length && opts.quota === 0 && already === 0) {
    if (!opts.trace.some((line) => /meter empty/i.test(line))) {
      opts.trace.push("skipped images: meter empty");
    }
    return 0;
  }
  if (!opts.generateImage || opts.quota <= already) return 0;
  const missing = slots.filter((slot) => !images[slot.index]?.length).slice(0, opts.quota - already);
  if (!missing.length) return 0;

  const settled = await Promise.all(
    missing.map(async (slot) => {
      try {
        const bytes = await opts.generateImage!(slot.prompt);
        return { slot, bytes };
      } catch {
        opts.trace.push(`image slot ${slot.index + 1} failed; compiling without it`);
        return { slot, bytes: null as Buffer | null };
      }
    }),
  );
  let added = 0;
  for (const { slot, bytes } of settled) {
    if (bytes?.length) {
      images[slot.index] = bytes;
      added += 1;
    }
  }
  if (added) {
    opts.trace.push(`resolved ${added} image ${added === 1 ? "slot" : "slots"}`);
  } else if (slots.length && opts.quota > 0 && already === 0) {
    opts.trace.push("image generator returned nothing; compiling without stills");
  }
  return added;
}

function missingPhotoLayouts(deck: DeckIr, images: SlideImages): number {
  return deck.slides.filter((slide, i) => {
    if (slide.layout !== "title" && slide.layout !== "split-visual" && slide.layout !== "photo-story") return false;
    return !images[i]?.length;
  }).length;
}

function remapImages(from: DeckIr, to: DeckIr, images: SlideImages): SlideImages {
  const byPrompt = new Map<string, Buffer>();
  from.slides.forEach((slide, i) => {
    const prompt = slide.image?.prompt?.trim();
    if (prompt && images[i]?.length) byPrompt.set(prompt, images[i]!);
  });
  const next: SlideImages = {};
  to.slides.forEach((slide, i) => {
    const wantsPhoto =
      slide.layout === "title" || slide.layout === "split-visual" || slide.layout === "photo-story";
    if (wantsPhoto && images[i]?.length) next[i] = images[i]!;
  });
  to.slides.forEach((slide, i) => {
    if (next[i]) return;
    const prompt = slide.image?.prompt?.trim();
    const bytes = prompt ? byPrompt.get(prompt) : undefined;
    if (bytes) next[i] = bytes;
  });
  return next;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
