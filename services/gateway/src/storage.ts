import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Storage } from "@google-cloud/storage";
import { extensionForMime } from "@alltheway/contracts";

import { env } from "./env.js";

/**
 * Artifact bytes.
 *
 * Firestore holds the index — who owns it, what versions exist, where each
 * one lives. Cloud Storage holds the bytes. The split is the same reasoning
 * as subscriptions and usage: two things with different lifecycles and
 * different access patterns should not share a document.
 *
 * ## The write order is load-bearing
 *
 * Bytes first, index second. Always.
 *
 * A half-failed write leaves one of two states. Bytes with no index row is an
 * orphaned blob — invisible, harmless, and swept by a lifecycle rule. An index
 * row pointing at bytes that were never written is a *broken artifact*: it
 * appears in the list, opens, and fails. One of those is garbage; the other is
 * a bug the user meets.
 *
 * ## Paths carry the owner
 *
 * `{uid}/{artifactId}/{n}` — the same reasoning as the Firestore path. An
 * object path that encodes the owner means a signed URL or a lifecycle rule
 * can be scoped without consulting a database, and a mistake in the code
 * cannot produce a path belonging to someone else.
 */

/**
 * The byte store, behind an interface.
 *
 * Same shape as the connector gateway's `RefreshTokenStore` and `PolicyStore`:
 * a real implementation for the deployed service, an in-memory one for tests
 * (passed at the call site), and an explicit disk store when ARTIFACTS_DIR is
 * set against the emulator. Production still requires ARTIFACTS_BUCKET.
 */
export interface ByteStore {
  put(uid: string, artifactId: string, n: number, body: Buffer, mimeType: string): Promise<string>;
  get(uid: string, artifactId: string, n: number): Promise<Buffer>;
  deleteAll(uid: string, artifactId: string): Promise<void>;
}

const storage = new Storage({ projectId: env.projectId });

/** Empty disables artifact storage rather than failing at import. */
export const bucketName = process.env.ARTIFACTS_BUCKET ?? "";

/**
 * Local-only byte store. Explicit, emulator-only: production still requires
 * ARTIFACTS_BUCKET. Set this so Work can generate and reopen files without GCS.
 */
const artifactsDir =
  env.production || env.usingEmulator === false
    ? ""
    : (process.env.ARTIFACTS_DIR ?? "").trim();

export const storageConfigured = bucketName !== "" || artifactsDir !== "";

function bucket() {
  if (!storageConfigured) {
    throw new Error(
      "ARTIFACTS_BUCKET is not set, so artifact bytes cannot be stored. " +
        "Set it from Terraform rather than defaulting to a bucket name here.",
    );
  }
  return storage.bucket(bucketName);
}

/**
 * Object path for one version.
 *
 * Exported so tests can assert the shape without reaching a network — the
 * owner appearing in the path is a property worth asserting, not an
 * implementation detail.
 */
export function objectPath(uid: string, artifactId: string, n: number): string {
  return `${uid}/${artifactId}/${n}`;
}

export async function putVersion(
  uid: string,
  artifactId: string,
  n: number,
  body: Buffer,
  mimeType: string,
): Promise<string> {
  const path = objectPath(uid, artifactId, n);
  await bucket().file(path).save(body, {
    contentType: mimeType,
    // Versions are immutable by construction — n never repeats — so a long
    // cache is safe and the canvas re-opens instantly. `private` because the
    // bytes are the user's, and nothing about this is public.
    metadata: { cacheControl: "private, max-age=31536000, immutable" },
  });
  return `gs://${bucketName}/${path}`;
}

export async function getVersion(
  uid: string,
  artifactId: string,
  n: number,
): Promise<Buffer> {
  const [body] = await bucket().file(objectPath(uid, artifactId, n)).download();
  return body;
}

/**
 * Delete every version's bytes for an artifact.
 *
 * Prefix-scoped to this user and this artifact. A delete that took a bare
 * artifact id would be one typo away from another user's prefix.
 */
export async function deleteArtifactBytes(uid: string, artifactId: string): Promise<void> {
  await bucket().deleteFiles({ prefix: `${uid}/${artifactId}/`, force: true });
}


/** The deployed implementation. */
export const gcsStore: ByteStore = {
  put: putVersion,
  get: getVersion,
  deleteAll: deleteArtifactBytes,
};

function diskStore(root: string): ByteStore {
  const fileFor = (uid: string, artifactId: string, n: number) =>
    path.join(root, uid, artifactId, String(n));
  return {
    async put(uid, artifactId, n, body, mimeType) {
      const file = fileFor(uid, artifactId, n);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      const ext = extensionForMime(mimeType);
      if (ext) await writeFile(`${file}${ext}`, body);
      return `file://${file.replaceAll("\\", "/")}`;
    },
    async get(uid, artifactId, n) {
      return readFile(fileFor(uid, artifactId, n));
    },
    async deleteAll(uid, artifactId) {
      await rm(path.join(root, uid, artifactId), { recursive: true, force: true });
    },
  };
}

/**
 * The store routes and persist actually use.
 *
 * Disk only when ARTIFACTS_DIR is set against the emulator. Tests still pass
 * inMemoryStore themselves.
 */
export const artifactStore: ByteStore = artifactsDir
  ? diskStore(path.resolve(artifactsDir))
  : gcsStore;

/**
 * For tests. Never selected implicitly — a caller must pass it, which is what
 * keeps a test double out of a deployed code path.
 */
export function inMemoryStore(): ByteStore {
  const files = new Map<string, Buffer>();
  return {
    async put(uid, artifactId, n, body) {
      files.set(objectPath(uid, artifactId, n), Buffer.from(body));
      return `mem://${objectPath(uid, artifactId, n)}`;
    },
    async get(uid, artifactId, n) {
      const found = files.get(objectPath(uid, artifactId, n));
      if (!found) throw new Error(`no bytes at ${objectPath(uid, artifactId, n)}`);
      return found;
    },
    async deleteAll(uid, artifactId) {
      const prefix = `${uid}/${artifactId}/`;
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
    },
  };
}
