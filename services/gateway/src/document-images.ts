import { createHash } from "node:crypto";
import { decode as decodeJpeg } from "jpeg-js";
import { GoogleAuth } from "google-auth-library";

/**
 * Same model as Studio / media.generate_image. Called only after Yes.
 *
 * Bytes are returned untouched so C2PA on a still is not stripped here.
 * 429 / 5xx retry with exponential backoff. Retry-After wins when present.
 */

const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const LOCATION = process.env.MEDIA_LOCATION || "global";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const SLIDE_STYLE =
  "Professional editorial photography for a board PowerPoint. Photorealistic, cinematic lighting, no text, no logos, no watermarks, no charts, no UI screenshots.";

export const IMAGE_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
export const IMAGE_RETRY_CAP = IMAGE_BACKOFF_MS.length;

export type StillAsset = {
  hash: string;
  prompt: string;
  bytes: Buffer;
  width: number;
  height: number;
  luminance: number;
};

export type StillCache = Map<string, StillAsset>;

export type StillMeta = {
  hash: string;
  prompt: string;
  width: number;
  height: number;
  luminance: number;
};

export function promptHash(prompt: string): string {
  return createHash("sha256")
    .update(prompt.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 16);
}

export function imageDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      const jpeg = decodeJpeg(bytes, { useTArray: true });
      return { width: jpeg.width, height: jpeg.height };
    } catch {
      /* fall through */
    }
  }
  return { width: 1024, height: 1024 };
}

export function meanLuminance(bytes: Buffer): number {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      const jpeg = decodeJpeg(bytes, { useTArray: true });
      const data = jpeg.data;
      let sum = 0;
      let n = 0;
      const step = Math.max(4, Math.floor(data.length / 4000) * 4);
      for (let i = 0; i + 2 < data.length; i += step) {
        sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
        n += 1;
      }
      return n ? Math.round(sum / n) : 128;
    } catch {
      return 128;
    }
  }
  return 128;
}

export function stillFromBytes(prompt: string, bytes: Buffer): StillAsset {
  const size = imageDimensions(bytes);
  return {
    hash: promptHash(prompt),
    prompt: prompt.trim(),
    bytes,
    width: size.width,
    height: size.height,
    luminance: meanLuminance(bytes),
  };
}

export function stillMeta(asset: StillAsset): StillMeta {
  return {
    hash: asset.hash,
    prompt: asset.prompt,
    width: asset.width,
    height: asset.height,
    luminance: asset.luminance,
  };
}

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

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function retryDelayMs(attempt: number, retryAfter: string | null, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(60_000, Math.max(250, Math.round(seconds * 1000)));
    }
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.min(60_000, Math.max(250, when - now));
  }
  const base = IMAGE_BACKOFF_MS[Math.min(attempt, IMAGE_BACKOFF_MS.length - 1)] ?? 16_000;
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitter);
}

export async function fetchWithBackoff(
  makeRequest: () => Promise<Response>,
  opts: { sleep?: (ms: number) => Promise<void>; attempts?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? IMAGE_RETRY_CAP;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await makeRequest();
    if (last.ok || !isRetryableStatus(last.status) || attempt === attempts - 1) return last;
    await sleep(retryDelayMs(attempt, last.headers.get("retry-after")));
  }
  return last!;
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

  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: `${trimmed}\n\n${SLIDE_STYLE}` }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  const response = await fetchWithBackoff(() =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    }),
  );
  if (!response.ok) {
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
