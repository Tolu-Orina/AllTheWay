/**
 * Code caps for one document-cell run.
 *
 * A prompt-level bound is advice. These are integers the model cannot increment.
 */

import { MAX_CRITIQUE_ROUNDS, MAX_IMAGES } from "./office-ir.js";

export type DocumentBudget = {
  /** 6 turns → planner + compile + screenshot + judge each turn. */
  critiqueRounds: number;
  maxImages: number;
  wallClockMs: number;
  criticTimeoutMs: number;
  criticMaxTokens: number;
  plannerTimeoutMs: number;
  plannerMaxTokens: number;
};

export const WALL_MS_PLAIN = 240_000;
export const WALL_MS_WITH_IMAGES = 420_000;
export const CRITIC_TIMEOUT_MS = 60_000;
export const CRITIC_MAX_TOKENS = 4_096;
export const PLANNER_TIMEOUT_MS = 90_000;
export const PLANNER_MAX_TOKENS = 24_576;
export const MORE_TURN_MS = 15_000;
export const RENDER_TIMEOUT_MS = 90_000;

export function documentBudget(hasImages: boolean, override?: Partial<DocumentBudget>): DocumentBudget {
  return {
    critiqueRounds: MAX_CRITIQUE_ROUNDS,
    maxImages: MAX_IMAGES,
    wallClockMs: hasImages ? WALL_MS_WITH_IMAGES : WALL_MS_PLAIN,
    criticTimeoutMs: CRITIC_TIMEOUT_MS,
    criticMaxTokens: CRITIC_MAX_TOKENS,
    plannerTimeoutMs: PLANNER_TIMEOUT_MS,
    plannerMaxTokens: PLANNER_MAX_TOKENS,
    ...override,
  };
}

export function remainingDeadline(startedAt: number, budget: DocumentBudget, now: number): number {
  return Math.max(0, budget.wallClockMs - (now - startedAt));
}
