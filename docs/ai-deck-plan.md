**Vision:** within Google’s current lineup, **Gemini 3.7 Flash is already one of the strongest at vision**, not a weak leftover. Roboflow Vision Evals (Aug 2026): **3.7 Flash 84.6% vs Gemini 3.1 Pro 83.1%**, ~5–8× cheaper, much faster. **Do not swap the judge to 3.1 Pro by default.**

The useful split is **role**, not “Pro sees better”:

| Job | Model | Why |
|---|---|---|
| Planner (JSON, edit retrieved boxes) | `gemini-3.7-flash` | Speed, structured output, UI-from-reference. Keep. |
| Judge (LibreOffice PNGs: Content/Design only) | **Keep Flash** until we A/B on *our* decks. Optional flag: `GEMINI_JUDGE_MODEL=gemini-3.1-pro-preview` | Pro is the document/OCR/reasoning model, not a proven layout critic. Same-family self-preference is real; Pro is the cheap experiment, not a quality unlock. |
| Slot photographs | `gemini-3.1-flash-lite-image` (today) | After Yes, once. Escalate **cover/hero only** to `gemini-3.1-flash-image` or `gemini-3-pro-image` if photorealism fails. Never generate graphs as pictures. |
| Embeddings | `gemini-embedding-2` @ 1536 | Unchanged. |

A better judge is a **different prompt + deterministic gate**, not a bigger Gemini.

---

**Multimodal RAG is still relevant.** The catalog already has the right atoms: screenshot, `gcsUri`, `coordinates`, `description.boxes[]` / `images[]` with x/y/w/h, prev/next. What is wrong is **how we use it** — the planner *looks at* that and still invents `f(C)`. RALF/PPTAgent/SlideCoder need a **structured, editable prior**. Throw away RAG and you go back to from-scratch geometry. Keep GCS + Firestore + the graph; change retrieval key (slot schema, not only brief text) and the planner contract (edit those boxes).

---

# Phased PPT implementation plan

**Locked.** Confirm-before-act. Images only after Yes. Cell never talks to the person. Native `.pptx` (pptxgenjs), not HTML, not a whole-slide bitmap, not Microsoft 365. Charge the **images** meter once per distinct prompt. Planner plans; worker paints; judge does not rewrite IR. No GRPO until we have logged (IR, violations, human) data.

Target loop after the work:

`Yes → generate stills once → retrieve layout → planner edits boxes around real pixels → validate/repair IR → compile → LibreOffice → Content/Design judge (skip if structure failed) → edit only what the judge named`

---

## Phase 0 — Measure what we have (a few days)

Without this, we cannot tell whether later phases work.

- Log per run: turns used, `imagesGenerated`, whether `fillImages` re-hit Vertex, critic score, pass/fail, degrade yes/no, wall ms.
- Add a **deterministic overlap/off-canvas count on the IR we already emit** (even if we do not gate yet) so we know the base rate.
- Judge variance: same PPTX, three judge calls; if scores swing >10 points, we never gate on `≥95`.
- Retrieval: for 20 real briefs, dump top-3 `themeId` + layout + slot counts vs the brief’s slide types.

**Done when:** a table exists for the last N prod/local decks. Files: `document-quality.ts` trace, a small `scripts/eval-slide-loop.ts` (extend `visual-qa-local.ts`).

---

## Phase 1 — Generate photographs first; stop wasting the meter (1–2 weeks)

**Why first:** kills missing-still → 79, and stops 6× `fillImages`.

1. After Yes, before the planner loop: collect `{kind:'generate', prompt}` from the **confirmed story brief** (not from later planner inventions). Cap `MAX_IMAGES` (8). Charge `recordUsage(uid, "images", n)` here.
2. `generateStill` once per **prompt hash**. Cache in-memory for the cell run; optional GCS later.
3. Generate at a **flexible default** (square or 4:3, 1K–2K). Do **not** lock 16:9 per slot. Worker **crops/scales** into the planner’s box (contain/cover + crop, no regen).
4. Pass `{ promptHash → { bytes, width, height } }` into the planner so it can see real aspect and (cheap) luminance for text colour. Saliency can be a luminance/edge map, not a second VLM.
5. Planner may **not** invent new generate slots. New prompt = new hash = generate then (still after Yes, still metered). If the brief had no image slots, skip this phase.
6. Worker `fillImages` becomes “lookup cache + crop”, not Vertex.

**Not:** full-slide bitmaps. **Not:** image gen at plan time.

**Done when:** one Yes produces at most N Vertex image calls for N unique prompts; turns 2–6 do not call Vertex images; missing planned stills cannot happen if generate succeeded.

Files: `document-images.ts`, `document-quality.ts` (`fillImages`), `office-persist.ts` (meter timing), `office-slides.ts` (crop).

---

## Phase 2 — Deterministic validator before paint (1–2 weeks)

**Why:** AeSlides-style checks on IR we already have. Catch overlap before LibreOffice.

On the planner’s `boxes[]` (slide 13.333×7.5):

| Check | Action |
|---|---|
| Pairwise overlap (non-ancestor) | Fail + ids + area |
| Off-canvas / negative | Fail |
| Missing planned image | Hard fail (not a judge hint) |
| Margins (e.g. 0.4") | Warn or fail |
| Centroid imbalance (x_tol 0.05, y_tol 0.15) | Warn |
| Contrast text vs fill (and vs cropped still, if we have it) | Warn / fail for WCAG-ish floor |

Emit `{ elementId, type, magnitude }[]`. **Do not rasterize to validate overlap.**

Text overflow: Phase 2 can approximate with `fontSize × chars` vs box; **real** `measureText` / font metrics in Phase 3.

If validator fails: **do not** compile, **do not** call the VLM judge. Send violations into the next planner turn (or repair in Phase 3).

Drop `VISUAL_PASS_SCORE = 95` as the **structural** gate. Keep a critic score only for Design/Content later.

**Done when:** overlapping IR never reaches LibreOffice; missing stills never reach the judge; `document-quality.test.ts` has fixtures.

Files: new `document-validate.ts`, `office-ir.ts` (`structuralIssues` already exists — extend, don’t parallel), `document-critic.ts` (stop min-capping to 70 as the only structural path).

---

## Phase 3 — Repair only the bad boxes (1–2 weeks)

Layout-Corrector pattern: **do not regenerate the whole deck** for a 0.2" overlap.

Deterministic first, then re-validate:

- Push overlapping boxes apart along the smaller overlap axis.
- Snap to a 0.083" (1/12") grid; clamp to margins.
- Shrink font toward a minimum (e.g. 12pt) on overflow estimate.
- Crop stills to the box (already from Phase 1).

If still invalid: planner in **edit mode** — previous IR + violation list, **not** a blank `f(C)`. Cap LLM edits to named element ids.

Reduce `MAX_CRITIQUE_ROUNDS` from 6 toward **3** once repair + generate-once land (LibreOffice is the expensive part).

**Done when:** most overlap is fixed without a new full geometry; traces show `repaired` vs `replanned`.

Files: `document-repair.ts`, `document-planner.ts` (edit-mode prompt), `document-quality.ts` loop.

---

## Phase 4 — RAG as retrieve-and-edit (2–3 weeks)

**Keep** `slideDesigns`, GCS PNGs, `gemini-embedding-2`, prev/next.

**Change the contract:**

1. **Index.** On each catalog node, store a **slot schema**: counts of title / body / picture / chart / number, plus `layout`. Retrieval = schema similarity **and** (optional) screenshot embedding. Brief embedding-only is the weak path (RALF: retrieval must match structure, not only topic).
2. **Retrieve.** Per target slide (or per functional type: title / section / content / close), pick **one** reference slide whose schema matches, then `expandTheme` for neighbours — those neighbours are **chrome consistency** (shared title y, margins, background), not extra inspiration dumps.
3. **Planner input.** Put the **actual `boxes[]` / `images[]` geometry** in the prompt as the starting IR. Screenshots still go in (RALF: appearance prior) — **as the thing being edited**, not a moodboard.
4. **Planner output.** Prefer `edits[]` (`replace_text`, `resize_box`, `swap_picture`, `drop_box`) applied to the reference; fallback full IR only if schema match is poor (log this; if it is common, fix indexing before more edit machinery).
5. **Coherence.** After all slides: snap title bands / margins to the theme’s first content slide. This is code, not a Coherence VLM (PPTEval’s weakest dimension).

**Done when:** a typical turn’s first IR has box coordinates that match a catalog slide within a small delta; prev/next share title y.

Files: `document-design.ts` / ingest, `document-design-rag.ts` (`retrieveSlideDesigns`, `groupRetrievedDecks`), `document-planner.ts`, `document-cell-prompt.ts`.

---

## Phase 5 — Judge that can rank, not a fake 95 (1–2 weeks)

Only after Phases 1–3, or we still pay 6 full renders.

1. **Structure** is the validator (Phase 2). Judge never scores overlap.
2. **Content** and **Design** as **1–5**, PPTEval-style describe-then-score, business-deck rubrics (not “academic background”).
3. **Gate:** structure passed AND Content ≥ 4 AND Design ≥ 4. **Or** pairwise: this turn’s Design ≥ last turn’s, and stop if both ≥ 4 or rounds exhausted. No blended 0–100.
4. Issues are **tagged** `{dimension, slideIndex, elementId?, note}` and go to the **editor** (Phase 3), not a score cap.
5. **Model:** default judge stays `gemini-3.7-flash`. Flag `GEMINI_JUDGE_MODEL` for an A/B on the Phase 0 set vs `gemini-3.1-pro-preview`. Promote Pro **only** if Design agreement with a human spot-check improves enough to justify cost/latency. Same `vertexJson` helper, different env.
6. Coherence: Phase 4 chrome snap + “same typeface / background across slides” in code. Do not add a third VLM call.

**Done when:** `criticPassed` means structure + Content/Design bands; traces show three numbers; 95 is gone.

Files: `document-critic.ts`, `document-cell-prompt.ts` (`JUDGE_SYSTEM`), `document-vertex.ts` (optional model override), `office-persist.ts` outcome copy.

---

## Phase 6 — Optional polish (only if Phase 0–5 still miss)

- Hero/cover stills: `gemini-3.1-flash-image` (not lite) for those prompts only.
- Persist prompt-hash stills in the session artifact sidecar so “Not quite” with the **same** prompt does not regenerate.
- Human 20-deck rating set; if Design variance is still high, pairwise-only gate.
- **Do not** do LaySPA/AeSlides GRPO until that set exists.

---

## Sequencing and what we do not do

| Order | Unlocks |
|---|---|
| 0 | Honesty |
| 1 | Meter, missing-image, planner sees real pixels |
| 2 | Cheap structural quality |
| 3 | Stop regenerating the whole deck |
| 4 | Human layouts as the prior (RAG earns its keep) |
| 5 | VLM used for what it can do |
| 6 | Extra pixels / extra model |

**Out of scope:** Beautiful.ai-style “cannot free-place”; generating the deck as one image; HTML/REPL like PPTAgent; putting the judge on Pro before we measure; training.

**Risk if retrieval is bad:** edit-the-wrong-layout is worse than from-scratch (RALF Top-1). Phase 0 + schema index **before** betting the planner on edits.

That is the plan: **same catalog, same confirm gate, same cell** — photographs first, geometry in code, RAG as an editable prior, Flash still the workhorse, Pro only if our decks say so.