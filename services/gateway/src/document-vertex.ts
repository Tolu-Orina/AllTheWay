import { vertexProject } from "./document-images.js";

/**
 * One Vertex JSON call. Planner and judge use this with different
 * system instructions and never share a contents transcript.
 */

export type VertexPart = Record<string, unknown>;

export async function vertexJson(opts: {
  system: string;
  parts: VertexPart[];
  temperature: number;
  maxOutputTokens: number;
}): Promise<unknown> {
  const project = await vertexProject();
  if (!project || project === "alltheway-local") {
    throw new Error("visual QA has no Vertex project");
  }
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = (await (await auth.getClient()).getAccessToken()).token;
  if (!token) throw new Error("visual QA could not authenticate");
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/global/publishers/google/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: {
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 240);
    throw new Error(`visual QA request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((p) => p.text ?? "")
    .join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(
      candidate?.finishReason === "MAX_TOKENS"
        ? "visual QA output truncated"
        : "visual QA returned no JSON",
    );
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    const reason = candidate?.finishReason === "MAX_TOKENS" ? "truncated" : (err as Error).message;
    throw new Error(`visual QA returned invalid JSON (${reason})`);
  }
}

export function mimeOf(page: Buffer): string {
  if (page.length >= 3 && page[0] === 0xff && page[1] === 0xd8 && page[2] === 0xff) return "image/jpeg";
  return "image/png";
}
