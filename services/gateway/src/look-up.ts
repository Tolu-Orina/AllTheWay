/**
 * One grounded look-up. Cited or silent.
 *
 * Meeting insights already proved Vertex `googleSearch` on this stack. Voice
 * and (via the research cell's own copy) companion/work use the same rule:
 * a URL that did not come back in groundingMetadata is not a citation.
 */

export type WebSource = { title: string; uri: string; snippet: string };

export function webChunksFromCandidate(candidate: {
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
    grounding_chunks?: Array<{ web?: { title?: string; uri?: string } }>;
  };
  grounding_metadata?: {
    groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
    grounding_chunks?: Array<{ web?: { title?: string; uri?: string } }>;
  };
}): { title: string; uri: string }[] {
  const meta = candidate.groundingMetadata ?? candidate.grounding_metadata;
  const chunks = meta?.groundingChunks ?? meta?.grounding_chunks ?? [];
  const out: { title: string; uri: string }[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = chunk.web;
    const uri = typeof web?.uri === "string" ? web.uri.trim() : "";
    if (!uri.startsWith("http") || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ title: (web?.title ?? "").trim() || uri, uri });
  }
  return out;
}

export function answerFromCandidate(candidate: {
  content?: { parts?: Array<{ text?: string }> };
}): string {
  return (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

/** Drop the claim if nothing on the web actually came back. */
export function citedLookup(
  answer: string,
  chunks: { title: string; uri: string }[],
): { answer: string; sources: WebSource[] } | { cannot: string } {
  if (!chunks.length) {
    return { cannot: "I could not look that up just now." };
  }
  const sources = chunks.map((c) => ({
    title: c.title,
    uri: c.uri,
    snippet: "",
  }));
  const spoken = answer.trim() || "I looked that up.";
  return { answer: spoken, sources };
}

export const LOOKUP_INSTRUCTION =
  "Answer in a few short sentences a person can act on. Use only the web " +
  "results you were given. Never invent a source or a URL. If you cannot " +
  "check, say so in one sentence.";
