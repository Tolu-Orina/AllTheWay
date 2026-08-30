/**
 * Product-catalog screenshots. Not user artifacts — those live under
 * {uid}/{artifactId}/{n} in ARTIFACTS_BUCKET. This bucket is sample decks
 * the planner retrieves after Yes.
 */

import { Storage } from "@google-cloud/storage";

export function catalogBucketName(): string {
  return (process.env.SLIDE_DESIGN_BUCKET ?? "").trim();
}

export function catalogObjectPath(deckId: string, slideFile: string): string {
  const base = slideFile.replace(/\\/g, "/").split("/").pop() || slideFile;
  return `catalog/${deckId}/${base}`;
}

export function parseGsUri(uri: string): { bucket: string; object: string } | null {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) return null;
  return { bucket: match[1]!, object: match[2]! };
}

function storage(): Storage {
  return new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
}

export async function uploadSlidePng(deckId: string, slideFile: string, bytes: Buffer): Promise<string> {
  const bucket = catalogBucketName();
  if (!bucket) throw new Error("SLIDE_DESIGN_BUCKET is not set");
  const object = catalogObjectPath(deckId, slideFile);
  await storage().bucket(bucket).file(object).save(bytes, {
    contentType: "image/png",
    metadata: { cacheControl: "private, max-age=31536000, immutable" },
  });
  return `gs://${bucket}/${object}`;
}

export async function downloadGcsUri(uri: string): Promise<Buffer> {
  const parsed = parseGsUri(uri);
  if (!parsed) throw new Error(`not a gs:// uri: ${uri}`);
  const [body] = await storage().bucket(parsed.bucket).file(parsed.object).download();
  return body;
}
