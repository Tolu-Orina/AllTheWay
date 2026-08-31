import { GoogleAuth } from "google-auth-library";

import { env } from "./env.js";
import {
  LOOKUP_INSTRUCTION,
  answerFromCandidate,
  citedLookup,
  webChunksFromCandidate,
  type WebSource,
} from "./look-up.js";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const TIMEOUT_MS = 8_000;

type Candidate = {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
  };
};

export async function groundedLookup(topic: string): Promise<
  { answer: string; sources: WebSource[] } | { cannot: string }
> {
  const query = topic.trim().slice(0, 500);
  if (!query) return { cannot: "I need to know what to look up." };

  const token = await auth.getAccessToken();
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${env.projectId}` +
      `/locations/${env.vertexLocation}/publishers/google/models/${env.model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        systemInstruction: { parts: [{ text: LOOKUP_INSTRUCTION }] },
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    return { cannot: "I could not look that up just now." };
  }

  const body = (await response.json().catch(() => null)) as
    | { candidates?: Candidate[] }
    | null;
  const candidate = body?.candidates?.[0];
  if (!candidate) return { cannot: "I could not look that up just now." };

  return citedLookup(answerFromCandidate(candidate), webChunksFromCandidate(candidate));
}

export type { WebSource };
