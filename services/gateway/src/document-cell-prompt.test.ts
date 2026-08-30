import assert from "node:assert/strict";
import { test } from "node:test";

import { JUDGE_SYSTEM, PLANNER_SYSTEM } from "./document-cell-prompt.js";

test("the planner prompt owns layout, background, and coordinates", () => {
  const s = PLANNER_SYSTEM.toLowerCase();
  assert.match(PLANNER_SYSTEM, /You are the document-cell planner/);
  assert.match(s, /do not talk to the person/);
  assert.match(s, /do not score/);
  assert.match(s, /title-slide/);
  assert.match(s, /title-and-two-columns/);
  assert.match(s, /big-number/);
  assert.match(s, /minified/);
  assert.match(s, /retrieved design graphs/);
  assert.match(s, /multimodal rag/);
  assert.match(s, /overall_deck_description/);
  assert.match(s, /scale onto our 13.333/);
  assert.match(s, /you own every x, y, w, h/);
  assert.match(s, /never a generated picture of a graph/);
  assert.match(s, /action titles/);
});

test("the judge prompt cannot rewrite the plan", () => {
  const s = JUDGE_SYSTEM.toLowerCase();
  assert.match(JUDGE_SYSTEM, /You are the document-cell judge/);
  assert.match(s, /you did not write this plan/);
  assert.match(s, /do not talk to the person/);
  assert.match(s, /do not rewrite/);
  assert.match(s, /no irpatch/);
  assert.match(s, /score >= 95/);
  assert.match(s, /libreoffice/);
  assert.doesNotMatch(s, /irpatch\.slides/);
});
