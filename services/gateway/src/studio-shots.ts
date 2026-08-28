/**
 * Veo generates at most 8 seconds. A longer clip is a sequence of shots
 * whose lengths sum to the request, capped at two minutes.
 */

export const SHOT_MAX_SECONDS = 8;
export const SEQUENCE_CAP_SECONDS = 120;

export type PlannedShot = {
  seconds: number;
  prompt: string;
};

export function shotDurations(
  total: number,
  maxShot = SHOT_MAX_SECONDS,
  cap = SEQUENCE_CAP_SECONDS,
): number[] {
  const t = Math.max(1, Math.min(cap, Math.floor(total)));
  const out: number[] = [];
  let left = t;
  while (left > 0) {
    const n = Math.min(maxShot, left);
    out.push(n);
    left -= n;
  }
  return out;
}

export function fallbackShotPrompt(brief: string, index: number, total: number): string {
  const trimmed = brief.trim();
  if (total <= 1) return trimmed;
  return (
    `${trimmed}\n\nThis is shot ${index + 1} of ${total}, continuing the same scene, ` +
    `people, lighting, and style. Do not restart the story.`
  );
}

export function mergePlan(
  userPrompt: string,
  total: number,
  planned: PlannedShot[] | null,
): PlannedShot[] {
  const durations = shotDurations(total);
  const prompts = (planned ?? []).map((s) => s.prompt.trim()).filter(Boolean);
  return durations.map((seconds, i) => ({
    seconds,
    prompt: prompts[i] || fallbackShotPrompt(userPrompt, i, durations.length),
  }));
}

export function parsePlanJson(text: string): PlannedShot[] | null {
  const stripped = text.replace(/^```(?:json)?|```$/gm, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { shots?: unknown };
    if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) return null;
    const shots: PlannedShot[] = [];
    for (const row of parsed.shots) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { prompt?: unknown; seconds?: unknown };
      const prompt = typeof rec.prompt === "string" ? rec.prompt.trim() : "";
      if (!prompt) continue;
      const seconds =
        typeof rec.seconds === "number" && Number.isFinite(rec.seconds)
          ? rec.seconds
          : SHOT_MAX_SECONDS;
      shots.push({ prompt, seconds });
    }
    return shots.length > 0 ? shots : null;
  } catch {
    return null;
  }
}

/** Browser poll: first wait 8s, then 11s, 16s, cap 20s. Veo is minutes. */
export function nextPollDelay(previousMs: number): number {
  if (previousMs <= 0) return 8_000;
  return Math.min(20_000, Math.round(previousMs * 1.4));
}
