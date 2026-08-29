import { GoogleAuth } from "google-auth-library";

/**
 * Same model as Studio / media.generate_image. Called only after Yes.
 *
 * Bytes are returned untouched so C2PA on a still is not stripped here.
 */

const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const LOCATION = process.env.MEDIA_LOCATION || "global";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const SLIDE_STYLE =
  "Professional editorial photography for a board PowerPoint. Photorealistic, cinematic lighting, no text, no logos, no watermarks, no charts, no UI screenshots.";

export async function vertexProject(): Promise<string> {
  const named = process.env.MEDIA_PROJECT || process.env.VERTEX_PROJECT || "";
  if (named) return named;
  const env = process.env.GOOGLE_CLOUD_PROJECT || "";
  if (env && env !== "alltheway-local") return env;
  try {
    return (await auth.getProjectId()) || env;
  } catch {
    return env;
  }
}

export async function generateStill(prompt: string): Promise<Buffer | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (process.env.SKIP_DOCUMENT_IMAGES === "1") return null;

  const project = await vertexProject();
  if (!project || project === "alltheway-local") return null;

  let token: string | null | undefined;
  try {
    const client = await auth.getClient();
    token = (await client.getAccessToken()).token;
  } catch {
    return null;
  }
  if (!token) return null;

  const host = LOCATION === "global" ? "aiplatform.googleapis.com" : `${LOCATION}-aiplatform.googleapis.com`;
  const url =
    `https://${host}/v1/projects/${project}/locations/${LOCATION}` +
    `/publishers/google/models/${IMAGE_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${trimmed}\n\n${SLIDE_STYLE}` }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const again = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${trimmed}\n\n${SLIDE_STYLE}` }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });
      if (again.ok) {
        const json = (await again.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
        };
        for (const candidate of json.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            const data = part.inlineData?.data;
            if (data) return Buffer.from(data, "base64");
          }
        }
      }
    }
    console.warn(`[document-images] ${response.status} ${await response.text().catch(() => "")}`.slice(0, 240));
    return null;
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  for (const candidate of json.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data) return Buffer.from(data, "base64");
    }
  }
  return null;
}
