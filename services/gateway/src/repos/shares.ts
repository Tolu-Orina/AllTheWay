import { FieldValue } from "firebase-admin/firestore";

import { artifacts, comments, db, shares, sharedWithMe } from "../firestore.js";

/**
 * Sharing an artifact: share, comment, resolve. Async and permissioned.
 *
 * ## The rule that shapes everything here
 *
 * **A share grants an artifact, never a corpus** (FR-D4e). Nothing in this file
 * touches `documentChunks`, and retrieval remains bound to a single user by the
 * scope token the librarian requires. So a shared artifact does not make the
 * documents behind it searchable by the grantee — not by policy, but because
 * there is no code path that could.
 *
 * That is worth being explicit about, because it is the intuitive thing to get
 * wrong: "they can see the report" reads as "they can ask about the report",
 * and one of those quietly hands over the source material.
 *
 * ## Two writes, one truth
 *
 * The share is written under the owner's artifact (where it belongs) and
 * indexed under the grantee (where it can be found). Both in one batch, so a
 * share is never half-created.
 *
 * The index points; it does not permit. Every read re-checks the authoritative
 * document, which means a stale index — or a forged one — produces a lookup
 * that then refuses. The cheap denormalised copy must never be the thing
 * standing between two tenants.
 *
 * ## Revocation stamps, it does not delete
 *
 * `revokedAt` is set and the row stays. Deleting it would erase the fact that
 * access once existed, and after an incident the question is always "who could
 * see this, and when" — which a deleted row cannot answer.
 */

export type Role = "viewer" | "commenter";

export interface Access {
  allowed: boolean;
  role: Role | null;
  /** Present when refused, for a message a person can act on. */
  reason: string;
}

const iso = (value: unknown): string | null =>
  value && typeof value === "object" && "toDate" in value
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

/**
 * May this user read this artifact, and in what capacity?
 *
 * The single gate. Ownership first because it is the common case and needs no
 * second read; then the authoritative share.
 */
export async function accessTo(
  viewerUid: string,
  ownerUid: string,
  artifactId: string,
): Promise<Access> {
  if (viewerUid === ownerUid) {
    return { allowed: true, role: "commenter", reason: "" };
  }

  const share = await shares(ownerUid, artifactId).doc(viewerUid).get();
  if (!share.exists) {
    // Deliberately the same answer as a missing artifact. Distinguishing them
    // would turn this into an oracle for which artifacts exist.
    return { allowed: false, role: null, reason: "That is not available to you." };
  }
  if (share.get("revokedAt")) {
    return { allowed: false, role: null, reason: "Your access to this was removed." };
  }

  const role = share.get("role");
  return {
    allowed: true,
    role: role === "commenter" ? "commenter" : "viewer",
    reason: "",
  };
}

export async function grantShare(input: {
  ownerUid: string;
  ownerEmail: string;
  artifactId: string;
  granteeUid: string;
  granteeEmail: string;
  role: Role;
  title: string;
}): Promise<void> {
  const batch = db.batch();

  batch.set(
    shares(input.ownerUid, input.artifactId).doc(input.granteeUid),
    {
      granteeUid: input.granteeUid,
      granteeEmail: input.granteeEmail,
      role: input.role,
      grantedBy: input.ownerUid,
      grantedAt: FieldValue.serverTimestamp(),
      // Explicitly cleared. Re-sharing after a revocation must restore access
      // rather than leave a revoked stamp that silently refuses every read.
      revokedAt: null,
    },
    { merge: true },
  );

  batch.set(
    sharedWithMe(input.granteeUid).doc(input.artifactId),
    {
      artifactId: input.artifactId,
      ownerUid: input.ownerUid,
      ownerEmail: input.ownerEmail,
      title: input.title,
      role: input.role,
      sharedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

export async function revokeShare(
  ownerUid: string,
  artifactId: string,
  granteeUid: string,
): Promise<boolean> {
  const ref = shares(ownerUid, artifactId).doc(granteeUid);
  const existing = await ref.get();
  if (!existing.exists) return false;

  const batch = db.batch();
  // Stamped, not deleted: the record of who could see this, and when, survives.
  batch.update(ref, { revokedAt: FieldValue.serverTimestamp() });
  // The index entry goes, because it is only a convenience for listing. The
  // authoritative row is what refuses, so removing this cannot grant anything.
  batch.delete(sharedWithMe(granteeUid).doc(artifactId));
  await batch.commit();
  return true;
}

export async function listShares(ownerUid: string, artifactId: string) {
  const snap = await shares(ownerUid, artifactId).get();
  return snap.docs
    .map((d) => ({
      granteeUid: d.id,
      granteeEmail: d.get("granteeEmail") ?? "",
      role: (d.get("role") === "commenter" ? "commenter" : "viewer") as Role,
      grantedBy: d.get("grantedBy") ?? "",
      grantedAt: iso(d.get("grantedAt")) ?? "",
      revokedAt: iso(d.get("revokedAt")),
    }))
    .filter((s) => s.revokedAt === null);
}

export async function listSharedWithMe(granteeUid: string) {
  const snap = await sharedWithMe(granteeUid).orderBy("sharedAt", "desc").limit(100).get();
  return snap.docs.map((d) => ({
    artifactId: d.get("artifactId") ?? d.id,
    ownerUid: d.get("ownerUid") ?? "",
    ownerEmail: d.get("ownerEmail") ?? "",
    title: d.get("title") ?? "Untitled",
    role: (d.get("role") === "commenter" ? "commenter" : "viewer") as Role,
    sharedAt: iso(d.get("sharedAt")) ?? "",
  }));
}

export async function addComment(input: {
  ownerUid: string;
  artifactId: string;
  authorUid: string;
  authorEmail: string;
  versionAnchor: number;
  body: string;
}): Promise<string> {
  const ref = comments(input.ownerUid, input.artifactId).doc();
  await ref.set({
    authorUid: input.authorUid,
    authorEmail: input.authorEmail,
    // The version as it was when the comment was written. Never "latest":
    // a remark about v2 that reattached to v5 would appear to be about text
    // nobody wrote.
    versionAnchor: input.versionAnchor,
    body: input.body,
    resolved: false,
    resolvedBy: null,
    at: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function listComments(ownerUid: string, artifactId: string) {
  const snap = await comments(ownerUid, artifactId).orderBy("at", "asc").limit(500).get();
  return snap.docs.map((d) => ({
    id: d.id,
    authorUid: d.get("authorUid") ?? "",
    authorEmail: d.get("authorEmail") ?? "",
    versionAnchor: Number(d.get("versionAnchor") ?? 1),
    body: d.get("body") ?? "",
    resolved: Boolean(d.get("resolved")),
    resolvedBy: d.get("resolvedBy") ?? null,
    at: iso(d.get("at")) ?? "",
  }));
}

export async function resolveComment(
  ownerUid: string,
  artifactId: string,
  commentId: string,
  resolvedBy: string,
): Promise<boolean> {
  const ref = comments(ownerUid, artifactId).doc(commentId);
  const doc = await ref.get();
  if (!doc.exists) return false;

  await ref.update({ resolved: true, resolvedBy });
  return true;
}

/** The artifact's title, for the grantee's index. Empty if it is not there. */
export async function titleOf(ownerUid: string, artifactId: string): Promise<string | null> {
  const doc = await artifacts(ownerUid).doc(artifactId).get();
  return doc.exists ? (doc.get("title") ?? "Untitled") : null;
}
