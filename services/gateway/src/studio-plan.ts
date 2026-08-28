import { GoogleAuth } from "google-auth-library";

import { env } from "./env.js";
import {
  mergePlan,
  parsePlanJson,
  shotDurations,
  type PlannedShot,
  SEQUENCE_CAP_SECONDS,
  SHOT_MAX_SECONDS,
} from "./studio-shots.js";

/**
 * Expand a video brief into consecutive Veo shots.
 *
 * The user typed one prompt. The model that generates the clip can only do
 * eight seconds. A planner that has already been paid for (Flash, not Veo)
 * is the cheap way to keep continuity across those shots.
 *
 * Failure is not fatal: we still split the duration and reuse the brief.
 */

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const TIMEOUT_MS = 20_000;

const INSTRUCTION = `You are planning a short video for a generator that can only make ${SHOT_MAX_SECONDS} seconds at a time.

The user wrote a brief. Your job is to make it a richer visual description the generator can film — same idea, more concrete: light, camera, people, motion, palette. Not a screenplay slug. Not a pitch.

Rules:
- Each shot is ${SHOT_MAX_SECONDS} seconds or less. Prefer ${SHOT_MAX_SECONDS} except the last remainder.
- The seconds must sum to exactly the requested total.
- If the total is ${SHOT_MAX_SECONDS} seconds or less, write exactly one shot.
- Keep one scene, the same people, lighting, and palette. Continuity is the product.
- Shot 2 must follow shot 1 in time. Do not restart. Do not repeat the same action.
- Do not mention the generator, shots, or these rules in the prompts.

Reply as JSON only:
{"shots":[{"seconds":8,"prompt":"..."}]}`;

export async function planVideoShots(userPrompt: string, totalSeconds: number): Promise<PlannedShot[]> {
  const total = Math.max(1, Math.min(SEQUENCE_CAP_SECONDS, Math.floor(totalSeconds)));
  const planned = await askPlanner(userPrompt, total).catch(() => null);
  return mergePlan(userPrompt, total, planned);
}

async function askPlanner(userPrompt: string, total: number): Promise<PlannedShot[] | null> {
  const token = await auth.getAccessToken();
  if (!token) return null;

  const durations = shotDurations(total);
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${env.projectId}` +
      `/locations/global/publishers/google/models/${env.model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `${INSTRUCTION}\n\nRequested total seconds: ${total}\n` +
                  `Write exactly ${durations.length} shots, lengths in order: ` +
                  `${durations.join(", ")}.\n\n` +
                  `--- BRIEF ---\n${userPrompt.trim()}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } | null;
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) return null;
  return parsePlanJson(text);
}
