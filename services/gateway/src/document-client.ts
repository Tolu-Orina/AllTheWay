import { authenticatingFetch } from "./a2a.js";
import type { DocumentQualityResult } from "./document-quality.js";

/**
 * One call to the document cell. Workers never appear here.
 * Unreachable or overtime → null, and the caller degrades to today's renderer.
 */

const TIMEOUT_MS = Number(process.env.DOCUMENT_CELL_TIMEOUT_MS ?? 480_000);

export function documentCellUrl(): string {
  if (process.env.DOCUMENT_CELL_URL !== undefined) {
    return process.env.DOCUMENT_CELL_URL.replace(/\/$/, "");
  }
  // Local emulator runs: Work Yes hits the cell on :8095 when that process is up.
  if (process.env.FIRESTORE_EMULATOR_HOST) return "http://127.0.0.1:8095";
  return "";
}

export async function invokeDocumentCell(payload: {
  tool: string;
  args: Record<string, unknown>;
  imagesRemaining: number | null;
}): Promise<DocumentQualityResult | null> {
  const base = documentCellUrl();
  if (!base) return null;

  const fetchImpl = authenticatingFetch(base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      title?: string;
      mimeType?: string;
      body?: string;
      prompt?: string;
      trace?: string[];
      degraded?: boolean;
      imagesGenerated?: number;
      compiles?: number;
      criticPassed?: boolean;
      criticScore?: number;
    };
    if (!json.body || !json.mimeType || !json.title) return null;
    return {
      title: json.title,
      mimeType: json.mimeType,
      body: Buffer.from(json.body, "base64"),
      prompt: json.prompt || `PowerPoint: ${json.title}`,
      trace: Array.isArray(json.trace) ? json.trace.map(String) : [],
      degraded: Boolean(json.degraded),
      imagesGenerated: Number(json.imagesGenerated ?? 0),
      compiles: Number(json.compiles ?? 1),
      criticPassed: Boolean(json.criticPassed),
      criticScore: Number(json.criticScore ?? 0),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
