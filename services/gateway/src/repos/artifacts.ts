import {
  ArtifactDetailSchema,
  ArtifactSchema,
  type Artifact,
  type ArtifactDetail,
  type ArtifactKind,
  type Provenance,
} from "@alltheway/contracts";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { artifacts, artifactVersions, db } from "../firestore.js";
import { MIME_WORD } from "../office-mime.js";
import { wordText } from "../office-preview.js";
import { artifactStore, type ByteStore } from "../storage.js";

/**
 * Artifacts: the durable, versioned things the agent produced.
 *
 * ## Versions are append-only, enforced in a transaction
 *
 * An artifact's history is evidence of how the work actually happened — that
 * is the whole reason the Feedback Ledger is valuable, and an artifact whose
 * history can be rewritten is worth less than no history at all.
 *
 * "Append-only" is not a convention here; it is a transaction. Reading
 * `currentVersion` and then writing `currentVersion + 1` outside one would let
 * two concurrent corrections both become version 3 — one silently overwriting
 * the other, which is precisely the loss this is meant to prevent.
 *
 * ## Bytes before index
 *
 * See `storage.ts`. An orphaned blob is garbage; an index row pointing at
 * bytes that were never written is a broken artifact the user meets.
 */

const iso = (value: unknown): string =>
  value instanceof Timestamp ? value.toDate().toISOString() : new Date(0).toISOString();

function toArtifact(id: string, data: FirebaseFirestore.DocumentData): Artifact {
  return ArtifactSchema.parse({
    id,
    kind: data.kind,
    title: data.title,
    sessionId: data.sessionId ?? "",
    currentVersion: data.currentVersion ?? 0,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    mimeType: data.mimeType ?? "",
    provenance: {
      agentId: data.provenance?.agentId ?? "",
      cardVersion: data.provenance?.cardVersion ?? "",
      model: data.provenance?.model ?? "",
      sources: data.provenance?.sources ?? [],
    },
  });
}

export async function listArtifacts(
  uid: string,
  limit = 50,
  sessionId?: string,
): Promise<Artifact[]> {
  if (sessionId) {
    // Equality only — no orderBy — so this does not wait on a composite index.
    const snap = await artifacts(uid).where("sessionId", "==", sessionId).get();
    return snap.docs
      .map((d) => toArtifact(d.id, d.data()))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, limit);
  }
  const snap = await artifacts(uid).orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => toArtifact(d.id, d.data()));
}

export async function getArtifact(
  uid: string,
  artifactId: string,
): Promise<ArtifactDetail | null> {
  const doc = await artifacts(uid).doc(artifactId).get();
  if (!doc.exists) return null;

  // Ordered by id, which is the version number — so no index is needed and the
  // ordering cannot disagree with the numbering.
  const versions = await artifactVersions(uid, artifactId).orderBy("n", "asc").get();

  return ArtifactDetailSchema.parse({
    ...toArtifact(doc.id, doc.data()!),
    versions: versions.docs.map((v) => ({
      n: v.get("n"),
      mimeType: v.get("mimeType"),
      bytes: v.get("bytes"),
      createdAt: iso(v.get("createdAt")),
      producedBy: v.get("producedBy"),
      prompt: v.get("prompt") ?? "",
      correction: v.get("correction") ?? "",
      supersedes: v.get("supersedes") ?? null,
    })),
  });
}

export type NewArtifact = {
  kind: ArtifactKind;
  title: string;
  sessionId?: string;
  provenance: Provenance;
  body: Buffer;
  mimeType: string;
  prompt?: string;
  producedBy?: "user" | "agent";
};

/**
 * Create an artifact with its first version.
 *
 * The artifact row is written first with `currentVersion: 0`, which is a state
 * meaning "exists, has nothing in it yet". `addVersion` then does the same
 * transactional append every later correction does — one code path for the
 * first version and the tenth, rather than a special case that drifts.
 */
export async function createArtifact(
  uid: string,
  input: NewArtifact,
  store: ByteStore = artifactStore,
): Promise<ArtifactDetail> {
  const ref = artifacts(uid).doc();

  await ref.set({
    // Redundant with the path, on purpose: layer 3 of the isolation defence.
    ownerUid: uid,
    kind: input.kind,
    title: input.title,
    sessionId: input.sessionId ?? "",
    currentVersion: 0,
    mimeType: input.mimeType,
    provenance: input.provenance,
    // User-attached files are indexed overnight, not on this turn. The
    // model reads the bytes now; the librarian learns from them later.
    indexPending: input.producedBy === "user",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await addVersion(uid, ref.id, {
    body: input.body,
    mimeType: input.mimeType,
    producedBy: input.producedBy ?? "agent",
    prompt: input.prompt ?? "",
    correction: "",
  }, store);

  const created = await getArtifact(uid, ref.id);
  if (!created) throw new Error("artifact vanished immediately after creation");
  return created;
}

export type NewVersion = {
  body: Buffer;
  mimeType: string;
  producedBy: "user" | "agent";
  prompt?: string;
  /** What the user said was wrong with the previous version. */
  correction?: string;
};

export async function renameArtifact(
  uid: string,
  artifactId: string,
  title: string,
): Promise<string> {
  const artifactRef = artifacts(uid).doc(artifactId);
  const doc = await artifactRef.get();
  if (!doc.exists) throw new NotFound(artifactId);
  const next = title.trim();
  if (!next) throw new Error("title required");
  await artifactRef.update({
    title: next,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return next;
}

export async function addVersion(
  uid: string,
  artifactId: string,
  input: NewVersion,
  store: ByteStore = artifactStore,
): Promise<number> {
  const artifactRef = artifacts(uid).doc(artifactId);

  // Reserve the number transactionally, before writing any bytes. Two
  // concurrent corrections must not both become version 3.
  const n = await db.runTransaction(async (tx) => {
    const doc = await tx.get(artifactRef);
    if (!doc.exists) throw new NotFound(artifactId);

    const next = (doc.get("currentVersion") ?? 0) + 1;
    tx.update(artifactRef, {
      currentVersion: next,
      mimeType: input.mimeType,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });

  // Bytes first. A failure here leaves currentVersion pointing at a version
  // whose row does not exist yet — visible as a gap, not as a broken read,
  // because getArtifact lists the versions that actually exist.
  const storagePath = await store.put(uid, artifactId, n, input.body, input.mimeType);

  await artifactVersions(uid, artifactId).doc(String(n)).set({
    n,
    storagePath,
    mimeType: input.mimeType,
    bytes: input.body.byteLength,
    producedBy: input.producedBy,
    prompt: input.prompt ?? "",
    correction: input.correction ?? "",
    supersedes: n > 1 ? n - 1 : null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return n;
}

export class NotFound extends Error {
  constructor(id: string) {
    super(`No artifact ${id}`);
  }
}

/**
 * Delete an artifact and every version's bytes.
 *
 * Index first here, deliberately reversing the create order. On create, an
 * orphaned blob is the safe failure; on delete, a *reachable* artifact whose
 * bytes are gone is the unsafe one. Both orders are chosen so the surviving
 * state is the harmless one.
 */
export async function deleteArtifact(
  uid: string,
  artifactId: string,
  store: ByteStore = artifactStore,
): Promise<boolean> {
  const ref = artifacts(uid).doc(artifactId);
  const doc = await ref.get();
  if (!doc.exists) return false;

  const versions = await artifactVersions(uid, artifactId).get();
  const batch = db.batch();
  versions.docs.forEach((v) => batch.delete(v.ref));
  batch.delete(ref);
  await batch.commit();

  await store.deleteAll(uid, artifactId);
  return true;
}

export type TurnFile = {
  name: string;
  mime: string;
  /** gs:// when Vertex can read the bucket. Empty locally. */
  fileUri?: string;
  /** Base64, only when there is no gs:// (emulator / disk store). */
  data?: string;
};

/**
 * How the planner should see a file on this turn: a GCS URI Vertex can
 * fetch, or the bytes themselves when this is not GCS.
 *
 * Gemini's generateContent document types are PDF and plain text. Images
 * (PNG, JPEG, WebP, HEIC) are native. Word is a ZIP the model cannot open, so
 * we lift the paragraphs and send them as text. Markdown is the same.
 *
 * The librarian is not involved. Indexing is overnight.
 */
export async function artifactFileRef(
  uid: string,
  artifactId: string,
  title: string,
  store: ByteStore = artifactStore,
): Promise<TurnFile | null> {
  const row = await artifacts(uid).doc(artifactId).get();
  if (!row.exists) return null;
  const n = Number(row.get("currentVersion") ?? 1);
  const verSnap = await artifactVersions(uid, artifactId).doc(String(n)).get();
  if (!verSnap.exists) return null;
  const mime = String(verSnap.get("mimeType") ?? "application/octet-stream");
  const storagePath = String(verSnap.get("storagePath") ?? "");
  if (vertexNative(mime, title) && storagePath.startsWith("gs://")) {
    return { name: title, mime, fileUri: storagePath };
  }
  try {
    const body = await store.get(uid, artifactId, n);
    return modelTurnFile(title, mime, body);
  } catch {
    if (storagePath.startsWith("gs://") && vertexNative(mime, title)) {
      return { name: title, mime, fileUri: storagePath };
    }
    return { name: title, mime };
  }
}

function vertexNative(mime: string, name: string): boolean {
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return true;
  return false;
}

function isWord(mime: string, name: string): boolean {
  return mime === MIME_WORD || /\.docx$/i.test(name);
}

function isPlainText(mime: string, name: string): boolean {
  return (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv" ||
    /\.(txt|md|markdown|csv)$/i.test(name)
  );
}

/** Bytes the planning model can actually read. */
export async function modelTurnFile(name: string, mime: string, body: Buffer): Promise<TurnFile> {
  if (isWord(mime, name)) {
    const text = await wordText(body);
    return { name, mime: "text/plain", data: Buffer.from(text, "utf8").toString("base64") };
  }
  if (isPlainText(mime, name)) {
    return { name, mime: "text/plain", data: body.toString("base64") };
  }
  if (vertexNative(mime, name)) {
    return { name, mime, data: body.toString("base64") };
  }
  return { name, mime, data: body.toString("base64") };
}

export async function listPendingIndex(
  uid: string,
  limit = 8,
): Promise<{ id: string; title: string; mimeType: string; currentVersion: number }[]> {
  const snap = await artifacts(uid).where("indexPending", "==", true).limit(limit).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    title: String(doc.get("title") ?? "document"),
    mimeType: String(doc.get("mimeType") ?? "application/octet-stream"),
    currentVersion: Number(doc.get("currentVersion") ?? 1),
  }));
}

export async function markIndexed(uid: string, artifactId: string, documentId: string): Promise<void> {
  await artifacts(uid).doc(artifactId).update({
    indexPending: false,
    documentId,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
