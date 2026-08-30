/**
 * Gemini Embedding 2 — one vector for a slide screenshot plus its
 * coordinate-level description. 1536 dims (MRL truncate from 3072) so
 * Firestore can index it. Product catalog, not user documents.
 *
 * Query is text-only in the same space (RETRIEVAL_QUERY). Documents fuse
 * image + text (RETRIEVAL_DOCUMENT). Never mix this with gemini-embedding-001.
 */

import {
  EMBEDDING_DIMENSIONS,
  SLIDE_EMBEDDING_LOCATION,
  SLIDE_EMBEDDING_MODEL,
} from "./document-design.js";
import { fetchWithBackoff, vertexProject } from "./document-images.js";
import { mimeOf } from "./document-vertex.js";

export type EmbedPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

export type EmbedTask = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

export function embedContentBody(opts: {
  parts: EmbedPart[];
  task: EmbedTask;
  dimensions?: number;
}): Record<string, unknown> {
  return {
    content: { parts: opts.parts },
    taskType: opts.task,
    outputDimensionality: opts.dimensions ?? EMBEDDING_DIMENSIONS,
    autoTruncate: true,
  };
}

export function embedContentBodyBeta(opts: {
  parts: EmbedPart[];
  task: EmbedTask;
  dimensions?: number;
}): Record<string, unknown> {
  return {
    content: { parts: opts.parts },
    config: {
      taskType: opts.task,
      outputDimensionality: opts.dimensions ?? EMBEDDING_DIMENSIONS,
      autoTruncate: true,
    },
  };
}

export function partsForSlide(opts: {
  text: string;
  image?: Buffer;
  gcsUri?: string;
}): EmbedPart[] {
  const parts: EmbedPart[] = [{ text: opts.text }];
  if (opts.gcsUri) {
    parts.push({ fileData: { fileUri: opts.gcsUri, mimeType: "image/png" } });
  } else if (opts.image?.length) {
    parts.push({
      inlineData: { mimeType: mimeOf(opts.image), data: opts.image.toString("base64") },
    });
  }
  return parts;
}

export async function embedMultimodal(opts: {
  parts: EmbedPart[];
  task: EmbedTask;
}): Promise<number[] | null> {
  if (!opts.parts.length) return null;
  const project = await vertexProject();
  if (!project || project === "alltheway-local") return null;
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  if (!token) return null;
  const location = SLIDE_EMBEDDING_LOCATION;
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const model = SLIDE_EMBEDDING_MODEL;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const attempts = [
    {
      url: `https://${host}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:embedContent`,
      body: embedContentBodyBeta({ parts: opts.parts, task: opts.task }),
    },
    {
      url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:embedContent`,
      body: embedContentBody({ parts: opts.parts, task: opts.task }),
    },
  ];
  let response: Response | undefined;
  let lastDetail = "";
  for (const attempt of attempts) {
    response = await fetchWithBackoff(() =>
      fetch(attempt.url, { method: "POST", headers, body: JSON.stringify(attempt.body) }),
    );
    if (response.ok) break;
    lastDetail = (await response.text().catch(() => "")).slice(0, 240);
    if (response.status !== 404 && response.status !== 400) break;
  }
  if (!response || !response.ok) {
    console.warn(`[slide-embed] ${response?.status} ${lastDetail}`);
    return null;
  }
  const json = (await response.json()) as {
    embedding?: { values?: number[] };
    embeddings?: Array<{ values?: number[] }>;
  };
  const values = json.embedding?.values ?? json.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    console.warn(`[slide-embed] expected ${EMBEDDING_DIMENSIONS} dims, got ${values?.length ?? 0}`);
    return null;
  }
  return values.map(Number);
}

export async function embedSlideDocument(opts: {
  text: string;
  image?: Buffer;
  gcsUri?: string;
}): Promise<number[] | null> {
  return embedMultimodal({
    parts: partsForSlide(opts),
    task: "RETRIEVAL_DOCUMENT",
  });
}

export async function embedSlideQuery(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return embedMultimodal({
    parts: [{ text: trimmed }],
    task: "RETRIEVAL_QUERY",
  });
}
