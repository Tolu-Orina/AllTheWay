import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  accessTo,
  addComment,
  grantShare,
  listComments,
  listShares,
  listSharedWithMe,
  resolveComment,
  revokeShare,
} from "./repos/shares.js";
import { db, sharedWithMe } from "./firestore.js";

/**
 * Sharing is the first feature where one user's data is deliberately visible to
 * another. Every test here is a way that could go further than intended.
 *
 * Run against the emulator on FIRESTORE_EMULATOR_HOST; skipped without it, and
 * the image starts one so CI does not quietly skip the whole file.
 */

const OWNER = `owner-${Date.now()}`;
const GRANTEE = `grantee-${Date.now()}`;
const STRANGER = `stranger-${Date.now()}`;
const ARTIFACT = `artifact-${Date.now()}`;

async function emulatorReachable(): Promise<boolean> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return false;
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const live = await emulatorReachable();
if (!live) {
  console.warn("\n  [shares] Firestore emulator not reachable — skipping.\n");
}
const emulated = { skip: !live };

const share = (role: "viewer" | "commenter" = "commenter") =>
  grantShare({
    ownerUid: OWNER,
    ownerEmail: "owner@example.com",
    artifactId: ARTIFACT,
    granteeUid: GRANTEE,
    granteeEmail: "grantee@example.com",
    role,
    title: "Q3 plan",
  });

test("an owner always reaches their own artifact", emulated, async () => {
  const access = await accessTo(OWNER, OWNER, ARTIFACT);
  strictEqual(access.allowed, true);
  strictEqual(access.role, "commenter");
});

test("a stranger reaches nothing", emulated, async () => {
  const access = await accessTo(STRANGER, OWNER, ARTIFACT);
  strictEqual(access.allowed, false);
  strictEqual(access.role, null);
});

test("a refusal does not reveal whether the artifact exists", emulated, async () => {
  // Two refusals that must read identically, or this becomes an oracle for
  // which artifacts a user has.
  const missing = await accessTo(STRANGER, OWNER, "no-such-artifact");
  const unshared = await accessTo(STRANGER, OWNER, ARTIFACT);
  strictEqual(missing.reason, unshared.reason);
});

test("a granted share is what opens it", emulated, async () => {
  await share("viewer");
  const access = await accessTo(GRANTEE, OWNER, ARTIFACT);
  strictEqual(access.allowed, true);
  strictEqual(access.role, "viewer");
});

test("the grantee's index does not grant anything on its own", emulated, async () => {
  /**
   * The most important test here.
   *
   * The index exists so a grantee can list what was shared without a
   * collection-group query. If it also *permitted*, then writing a row into
   * your own subtree would grant you someone else's artifact — the cheap
   * denormalised copy would be the thing standing between two tenants.
   */
  await sharedWithMe(STRANGER).doc(ARTIFACT).set({
    artifactId: ARTIFACT,
    ownerUid: OWNER,
    ownerEmail: "owner@example.com",
    title: "Q3 plan",
    role: "commenter",
    sharedAt: new Date(),
  });

  const listed = await listSharedWithMe(STRANGER);
  ok(listed.length > 0, "the forged index row is present");

  // …and it opens nothing, because the authoritative record is consulted.
  const access = await accessTo(STRANGER, OWNER, ARTIFACT);
  strictEqual(access.allowed, false);
});

test("revoking closes it, and the record of access survives", emulated, async () => {
  await share("commenter");
  strictEqual((await accessTo(GRANTEE, OWNER, ARTIFACT)).allowed, true);

  strictEqual(await revokeShare(OWNER, ARTIFACT, GRANTEE), true);

  const after = await accessTo(GRANTEE, OWNER, ARTIFACT);
  strictEqual(after.allowed, false);
  ok(after.reason.includes("removed"), after.reason);
});

test("re-sharing after a revocation actually restores access", emulated, async () => {
  // The revoked stamp has to be cleared. Left in place, a re-share would look
  // successful in the interface and refuse every read.
  await share("commenter");
  await revokeShare(OWNER, ARTIFACT, GRANTEE);
  await share("commenter");

  strictEqual((await accessTo(GRANTEE, OWNER, ARTIFACT)).allowed, true);
});

test("a revoked share is not listed as current access", emulated, async () => {
  await share("viewer");
  await revokeShare(OWNER, ARTIFACT, GRANTEE);

  const current = await listShares(OWNER, ARTIFACT);
  strictEqual(current.find((s) => s.granteeUid === GRANTEE), undefined);
});

test("a comment stays anchored to the version it was written about", emulated, async () => {
  // A remark about v2 that reattached to v5 would appear to be about text
  // nobody wrote, and the commenter would look careless.
  const id = await addComment({
    ownerUid: OWNER,
    artifactId: ARTIFACT,
    authorUid: GRANTEE,
    authorEmail: "grantee@example.com",
    versionAnchor: 2,
    body: "This clause contradicts section 4.",
  });

  const found = (await listComments(OWNER, ARTIFACT)).find((c) => c.id === id);
  strictEqual(found?.versionAnchor, 2);
  strictEqual(found?.resolved, false);
});

test("resolving records who resolved it", emulated, async () => {
  const id = await addComment({
    ownerUid: OWNER,
    artifactId: ARTIFACT,
    authorUid: GRANTEE,
    authorEmail: "grantee@example.com",
    versionAnchor: 1,
    body: "Typo in the header.",
  });

  strictEqual(await resolveComment(OWNER, ARTIFACT, id, OWNER), true);

  const found = (await listComments(OWNER, ARTIFACT)).find((c) => c.id === id);
  strictEqual(found?.resolved, true);
  strictEqual(found?.resolvedBy, OWNER);
});

test("resolving something that is not there is not a silent success", emulated, async () => {
  strictEqual(await resolveComment(OWNER, ARTIFACT, "no-such-comment", OWNER), false);
});


test("sharing an artifact does not hand over the corpus behind it", emulated, async () => {
  /**
   * FR-D4e, and the intuitive thing to get wrong.
   *
   * "They can see the report" reads as "they can ask about the report", and one
   * of those quietly shares the source documents the report was built from.
   *
   * Retrieval is bound to a single user by the scope token the librarian
   * demands, and nothing in the sharing path writes to a corpus. This asserts
   * the observable half: after a share, the grantee's own document and chunk
   * collections are exactly as empty as they were.
   */
  const before = await db.collection("users").doc(GRANTEE).collection("documents").get();
  const chunksBefore = await db
    .collection("users")
    .doc(GRANTEE)
    .collection("documentChunks")
    .get();

  await share("commenter");

  const after = await db.collection("users").doc(GRANTEE).collection("documents").get();
  const chunksAfter = await db
    .collection("users")
    .doc(GRANTEE)
    .collection("documentChunks")
    .get();

  strictEqual(after.size, before.size, "sharing added documents to the grantee");
  strictEqual(chunksAfter.size, chunksBefore.size, "sharing added chunks to the grantee");
});

test("a share names one artifact and cannot name a second", emulated, async () => {
  // The grant is keyed by artifact id. There is no wildcard, no folder and no
  // "everything I own" — so a share cannot widen by being written differently.
  await share("viewer");

  const other = `other-${Date.now()}`;
  const access = await accessTo(GRANTEE, OWNER, other);
  strictEqual(access.allowed, false);
});
