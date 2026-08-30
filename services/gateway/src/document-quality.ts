import { buildOfficeFile, type OfficeFile } from "./office-files.js";
import {
  MORE_TURN_MS,
  RENDER_TIMEOUT_MS,
  documentBudget,
  remainingDeadline,
  type DocumentBudget,
} from "./document-budget.js";
import { critiqueDeck, normalizeCritique, vertexVision, type Critique } from "./document-critic.js";
import { renderPptxPagesOrThrow, type RenderPagesFn } from "./document-libreoffice.js";
import { vertexPlanner, type PlannerFn, type PlannerInput } from "./document-planner.js";
import { realizeDeck } from "./office-layouts.js";
import { compileDeck, type SlideImages } from "./office-slides.js";
import {
  CONTENT_PASS_BAND,
  DESIGN_PASS_BAND,
  imageSlots,
  parseDeck,
  validateDeck,
  type DeckIr,
} from "./office-ir.js";
import { promptHash, stillFromBytes, stillMeta, type StillCache } from "./document-images.js";
import { validateLayout, violationNotes } from "./document-validate.js";
import { repairLayout, snapChrome } from "./document-repair.js";
import { extractPptxGeometry, textCollisions } from "./document-pptx-geometry.js";

/**
 * Bounded document-cell graph. One call, workers invisible.
 *
 * 1. Parse the story brief
 * 2. Generate stills once (prompt hash cache)
 * 3. For at most 3 turns:
 *    planner (edit retrieved boxes) → repair → validate
 *    if structure fails: skip compile and judge
 *    else: compile → LibreOffice → Content/Design judge
 * 4. Pass when structure holds and Content ≥ 4 and Design ≥ 4
 */

export type GenerateImageFn = (prompt: string) => Promise<Buffer | null>;
export type CriticFn = (deck: DeckIr, pages: Buffer[]) => Promise<Partial<Critique>>;

export type DocumentQualityInput = {
  tool: string;
  args: Record<string, unknown>;
  imagesRemaining: number | null;
  generateImage?: GenerateImageFn;
  planner?: PlannerFn;
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
  contentScore: number;
  designScore: number;
};

export async function compileWorkFile(opts: {
  tool: string;
  args: Record<string, unknown>;
  imagesRemaining: number | null;
  callCell?: () => Promise<DocumentQualityResult | null>;
  generateImage?: GenerateImageFn;
  planner?: PlannerFn;
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
      contentScore: 0,
      designScore: 0,
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
      contentScore: 5,
      designScore: 5,
    };
  }

  const brief = parseDeck(opts.args);
  const planner: PlannerFn = opts.planner ?? vertexPlanner;
  const critic: CriticFn =
    opts.critic ?? ((current, pages) => critiqueDeck(current, pages, vertexVision));
  const renderPages: RenderPagesFn = opts.renderPages ?? renderPptxPagesOrThrow;

  let deck = realizeDeck(brief);
  const hasImages =
    imageSlots(deck).length > 0 && (opts.imagesRemaining === null || opts.imagesRemaining > 0);
  const budget = documentBudget(hasImages, opts.budget);
  const quota =
    opts.imagesRemaining === null ? budget.maxImages : Math.max(0, Math.min(budget.maxImages, opts.imagesRemaining));

  const cache: StillCache = new Map();
  let images: SlideImages = {};
  let imagesGenerated = 0;
  let last: OfficeFile | undefined;
  let compiles = 0;
  let criticPassed = false;
  let criticScore = 0;
  let contentScore = 0;
  let designScore = 0;
  let lastDesign = 0;
  let degraded = false;
  let lastIssues: string[] = [];
  let overlapCount = 0;
  let offCanvasCount = 0;
  let turnsUsed = 0;

  imagesGenerated += await generateBriefStills(deck, cache, {
    generateImage: opts.generateImage,
    quota,
    trace,
  });
  const vertexImageHits = imagesGenerated;

  for (let turn = 0; turn < budget.critiqueRounds; turn++) {
    turnsUsed = turn + 1;
    const remaining = remainingDeadline(started, budget, now());
    if (turn > 0 && remaining < MORE_TURN_MS) {
      trace.push("wall clock exhausted; keeping last compile");
      degraded = true;
      break;
    }

    try {
      const planned = await withTimeout(
        planner({
          brief,
          previous: turn > 0 ? deck : undefined,
          issues: turn > 0 ? lastIssues : undefined,
          stills: [...cache.values()].map(stillMeta),
          editMode: turn > 0,
        } satisfies PlannerInput),
        budget.plannerTimeoutMs,
      );
      deck = realizeDeck(validateDeck(planned));
      trace.push(`planner turn ${turn + 1}: ${deck.slides.length} slides`);
    } catch (err) {
      trace.push(`planner turn ${turn + 1} failed: ${(err as Error).message || "timeout"}`);
      if (turn === 0) deck = realizeDeck(brief);
    }

    imagesGenerated += await generateMissingStills(deck, cache, {
      generateImage: opts.generateImage,
      quota,
      already: imagesGenerated,
      trace,
    });
    images = bindStills(deck, cache);

    const beforeRepair = JSON.stringify(deck);
    let report = validateLayout(deck, images, cache, quota > 0 && imageSlots(deck).length > 0);
    if (!report.ok) {
      const repaired = repairLayout(deck, report.failures);
      deck = snapChrome(repaired.deck);
      if (repaired.changed || JSON.stringify(deck) !== beforeRepair) {
        trace.push(`repaired turn ${turn + 1}`);
      }
      report = validateLayout(deck, images, cache, quota > 0 && imageSlots(deck).length > 0);
    } else {
      deck = snapChrome(deck);
    }
    overlapCount = report.overlapCount;
    offCanvasCount = report.offCanvasCount;

    if (!report.ok) {
      lastIssues = violationNotes(report);
      trace.push(
        `structure turn ${turn + 1}: fail overlap=${report.overlapCount} offCanvas=${report.offCanvasCount} — ${lastIssues.slice(0, 3).join("; ")}`,
      );
      continue;
    }

    last = await compileDeck(deck, images);
    compiles += 1;

    // The same question, asked of the file rather than the plan.
    //
    // `validateLayout` above reads the deck IR, and is the right check for
    // a planner that stacks two boxes. It cannot see a compiler that does:
    // a deck passed here with overlap=0 while slide 2 shipped its title and
    // both column titles at one origin, three deep and unreadable -- and the
    // critic scored it 4/5 for design while looking straight at it.
    //
    // Text against text only: a background is meant to sit under everything,
    // and a caption over an image is a design rather than a fault.
    const collisions = textCollisions(await extractPptxGeometry(last.body));
    if (collisions.length > 0) {
      overlapCount = collisions.length;
      lastIssues = collisions
        .slice(0, 6)
        .map((c) => `slide ${c.slide}: ${c.a} overlaps ${c.b} (${c.area}in2)`);
      trace.push(
        `compiled geometry turn ${turn + 1}: fail overlap=${collisions.length} - ${lastIssues.slice(0, 3).join("; ")}`,
      );
      continue;
    }

    let pages: Buffer[] = [];
    try {
      const renderMs = Math.min(RENDER_TIMEOUT_MS, Math.max(8_000, remainingDeadline(started, budget, now())));
      pages = await withTimeout(renderPages(last.body), renderMs);
    } catch (err) {
      const reason = (err as Error).message || "LibreOffice render failed";
      criticScore = 0;
      contentScore = 0;
      designScore = 0;
      lastIssues = [reason];
      trace.push(`visual QA turn ${turn + 1}: 0/5 (${reason})`);
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
      criticScore = 0;
      contentScore = 0;
      designScore = 0;
      lastIssues = ["visual QA timed out"];
      degraded = true;
      trace.push(`visual QA turn ${turn + 1}: timed out`);
      break;
    }
    contentScore = critique.content;
    designScore = critique.design;
    criticScore = critique.score;
    lastIssues = critique.issues;
    const pairwiseOk = lastDesign === 0 || critique.design >= lastDesign;
    lastDesign = critique.design;
    if (critique.pass || (pairwiseOk && critique.content >= CONTENT_PASS_BAND && critique.design >= DESIGN_PASS_BAND)) {
      criticPassed = true;
      trace.push(
        `visual QA turn ${turn + 1}: content ${critique.content}/5 design ${critique.design}/5 pass`,
      );
      console.info(
        `[document-cell] visual QA turn ${turn + 1}: content ${critique.content}/5 design ${critique.design}/5 pass`,
      );
      break;
    }
    trace.push(
      `visual QA turn ${turn + 1}: content ${critique.content}/5 design ${critique.design}/5 — ${(critique.issues ?? []).join("; ") || `need ${CONTENT_PASS_BAND}+ / ${DESIGN_PASS_BAND}+`}`,
    );
    console.info(
      `[document-cell] visual QA turn ${turn + 1}: content ${critique.content}/5 design ${critique.design}/5 — ${(critique.issues ?? []).slice(0, 3).join("; ")}`,
    );
    if (turn === budget.critiqueRounds - 1) {
      degraded = true;
      trace.push(
        `visual QA still below Content ${CONTENT_PASS_BAND} Design ${DESIGN_PASS_BAND} after ${budget.critiqueRounds} turns; keeping last compile`,
      );
      break;
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

  const wallMs = now() - started;
  trace.unshift(
    `Compiled ${deck.slides.length} slides, ${imagesGenerated} images, ` +
      (criticPassed
        ? `critic passed content ${contentScore}/5 design ${designScore}/5`
        : `critic content ${contentScore}/5 design ${designScore}/5 (need ${CONTENT_PASS_BAND}+)`),
  );
  trace.push(
    `run: turns=${turnsUsed} imagesGenerated=${imagesGenerated} vertexImageHits=${vertexImageHits} content=${contentScore} design=${designScore} structure=${criticPassed ? "pass" : "fail"} degrade=${degraded} wallMs=${wallMs} overlap=${overlapCount} offCanvas=${offCanvasCount}`,
  );

  return {
    ...last,
    trace,
    degraded,
    imagesGenerated,
    compiles,
    criticPassed,
    criticScore,
    contentScore,
    designScore,
  };
}

async function generateBriefStills(
  deck: DeckIr,
  cache: StillCache,
  opts: { generateImage?: GenerateImageFn; quota: number; trace: string[] },
): Promise<number> {
  const slots = uniqueByHash(imageSlots(deck));
  if (slots.length && opts.quota === 0) {
    opts.trace.push("skipped images: meter empty");
    return 0;
  }
  if (!opts.generateImage || opts.quota <= 0 || !slots.length) return 0;
  return fillCache(slots.slice(0, opts.quota), cache, opts.generateImage, opts.trace);
}

async function generateMissingStills(
  deck: DeckIr,
  cache: StillCache,
  opts: {
    generateImage?: GenerateImageFn;
    quota: number;
    already: number;
    trace: string[];
  },
): Promise<number> {
  if (!opts.generateImage || opts.already >= opts.quota) return 0;
  const missing = uniqueByHash(imageSlots(deck)).filter((slot) => !cache.has(promptHash(slot.prompt)));
  if (!missing.length) return 0;
  opts.trace.push(`planner invented ${missing.length} new still prompt(s)`);
  return fillCache(missing.slice(0, opts.quota - opts.already), cache, opts.generateImage, opts.trace);
}

async function fillCache(
  slots: Array<{ id: string; prompt: string }>,
  cache: StillCache,
  generateImage: GenerateImageFn,
  trace: string[],
): Promise<number> {
  const settled = await Promise.all(
    slots.map(async (slot) => {
      const hash = promptHash(slot.prompt);
      if (cache.has(hash)) return 0;
      try {
        const bytes = await generateImage(slot.prompt);
        if (!bytes?.length) {
          trace.push(`image ${slot.id} failed; compiling without it`);
          return 0;
        }
        cache.set(hash, stillFromBytes(slot.prompt, bytes));
        return 1;
      } catch {
        trace.push(`image ${slot.id} failed; compiling without it`);
        return 0;
      }
    }),
  );
  let added = 0;
  for (const n of settled) added += n;
  if (added) trace.push(`resolved ${added} image ${added === 1 ? "slot" : "slots"}`);
  else if (slots.length && !cache.size) {
    trace.push("image generator returned nothing; compiling without stills");
  }
  return added;
}

function bindStills(deck: DeckIr, cache: StillCache): SlideImages {
  const images: SlideImages = {};
  for (const slot of imageSlots(deck)) {
    const asset = cache.get(promptHash(slot.prompt));
    if (asset) images[slot.id] = asset.bytes;
  }
  return images;
}

function uniqueByHash(slots: Array<{ id: string; prompt: string }>): Array<{ id: string; prompt: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; prompt: string }> = [];
  for (const slot of slots) {
    const hash = promptHash(slot.prompt);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(slot);
  }
  return out;
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
