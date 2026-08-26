import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addVersion,
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
} from "./repos/artifacts.js";
import { inMemoryStore, objectPath } from "./storage.js";

/**
 * Artifacts, against a real Firestore emulator.
 *
 * The transaction that makes versions append-only cannot be tested against a
 * mock — a fake datastore would simply agree with whatever the code does,
 * which is exactly the failure mode this repo keeps finding. So these run
 * against the emulator on FIRESTORE_EMULATOR_HOST, and are skipped with a
 * loud message when it is absent rather than silently passing.
 *
 * The byte store is injected (`inMemoryStore`) because Cloud Storage has no
 * emulator worth running here and the bytes are not what is under test.
 */

const ALICE = `alice-${Date.now()}`;
const BOB = `bob-${Date.now()}`;

const store = inMemoryStore();
const body = (text: string) => Buffer.from(text, "utf8");

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
  console.warn(
    "\n  [artifacts] Firestore emulator not reachable — skipping.\n" +
      "  Start it with:  npx firebase-tools emulators:start --only firestore\n",
  );
}

const emulated = { skip: !live };

async function seed(uid: string, title = "Onboarding wireframe") {
  return createArtifact(
    uid,
    {
      kind: "doc",
      title,
      provenance: { agentId: "gateway", cardVersion: "1.0.0", model: "", sources: [] },
      body: body("# v1"),
      mimeType: "text/markdown",
      prompt: "draft the onboarding screen",
    },
    store,
  );
}

/* ------------------------------------------------------- append-only */

test("a new artifact starts at version 1", emulated, async () => {
  const artifact = await seed(ALICE);
  assert.equal(artifact.currentVersion, 1);
  assert.equal(artifact.versions.length, 1);
  assert.equal(artifact.versions[0]!.supersedes, null);
});

test("a correction appends rather than replacing", emulated, async () => {
  const artifact = await seed(ALICE);

  await addVersion(ALICE, artifact.id, {
    body: body("# v2"),
    mimeType: "text/markdown",
    producedBy: "user",
    correction: "too much blue",
  }, store);

  const after = await getArtifact(ALICE, artifact.id);
  assert.equal(after!.currentVersion, 2);
  assert.equal(after!.versions.length, 2);
  // v1 is untouched. An artifact whose history can be rewritten is worth less
  // than no history at all.
  assert.equal(after!.versions[0]!.n, 1);
  assert.equal(after!.versions[1]!.supersedes, 1);
  assert.equal(await store.get(ALICE, artifact.id, 1).then((b) => b.toString()), "# v1");
});

test("the correction is kept, because it is the learning signal", emulated, async () => {
  const artifact = await seed(ALICE);
  await addVersion(ALICE, artifact.id, {
    body: body("# v2"),
    mimeType: "text/markdown",
    producedBy: "user",
    correction: "softer corners",
  }, store);

  const after = await getArtifact(ALICE, artifact.id);
  assert.equal(after!.versions[1]!.correction, "softer corners");
  assert.equal(after!.versions[1]!.producedBy, "user");
});

test("concurrent corrections do not collide on a version number", emulated, async () => {
  // The reason the append is a transaction. Read-then-write outside one lets
  // two corrections both become version 2, and one silently disappears.
  const artifact = await seed(ALICE);

  const results = await Promise.all(
    ["a", "b", "c", "d"].map((tag) =>
      addVersion(ALICE, artifact.id, {
        body: body(`# ${tag}`),
        mimeType: "text/markdown",
        producedBy: "agent",
      }, store),
    ),
  );

  assert.deepEqual([...results].sort(), [2, 3, 4, 5]);
  const after = await getArtifact(ALICE, artifact.id);
  assert.equal(after!.versions.length, 5);
});

/* ------------------------------------------------------ isolation */

test("one user cannot read another user's artifact", emulated, async () => {
  const alices = await seed(ALICE, "Alice's contract summary");

  // Bob knows the id and asks for it. The repository scopes by path, so this
  // is not a permission check that could be forgotten — the document is
  // simply not there.
  assert.equal(await getArtifact(BOB, alices.id), null);
});

test("one user's list never contains another user's artifact", emulated, async () => {
  const alices = await seed(ALICE, "Alice only");
  await seed(BOB, "Bob only");

  const bobs = await listArtifacts(BOB);
  assert.ok(!bobs.some((a) => a.id === alices.id));
  assert.ok(bobs.every((a) => a.title !== "Alice only"));
});

test("one user cannot append a version to another user's artifact", emulated, async () => {
  const alices = await seed(ALICE);

  await assert.rejects(
    addVersion(BOB, alices.id, {
      body: body("# injected"),
      mimeType: "text/markdown",
      producedBy: "user",
    }, store),
  );

  // And Alice's artifact is untouched.
  const after = await getArtifact(ALICE, alices.id);
  assert.equal(after!.currentVersion, 1);
});

test("one user cannot delete another user's artifact", emulated, async () => {
  const alices = await seed(ALICE);
  assert.equal(await deleteArtifact(BOB, alices.id, store), false);
  assert.ok(await getArtifact(ALICE, alices.id));
});

test("the object path carries the owner", () => {
  // Not decoration: a path that encodes the owner means a lifecycle rule or a
  // signed URL can be scoped without consulting a database.
  assert.equal(objectPath("u1", "a1", 3), "u1/a1/3");
  assert.ok(objectPath("u1", "a1", 3).startsWith("u1/"));
});

/* --------------------------------------------------------- lifecycle */

test("delete removes the artifact, its versions and its bytes", emulated, async () => {
  const artifact = await seed(ALICE);
  await addVersion(ALICE, artifact.id, {
    body: body("# v2"),
    mimeType: "text/markdown",
    producedBy: "user",
  }, store);

  assert.equal(await deleteArtifact(ALICE, artifact.id, store), true);
  assert.equal(await getArtifact(ALICE, artifact.id), null);
  await assert.rejects(store.get(ALICE, artifact.id, 1));
  await assert.rejects(store.get(ALICE, artifact.id, 2));
});

test("deleting something that is not there is not an error", emulated, async () => {
  assert.equal(await deleteArtifact(ALICE, "never-existed", store), false);
});

test("export bytes round-trip exactly", emulated, async () => {
  // Including bytes that are not valid UTF-8, because an image will not be.
  const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
  const artifact = await createArtifact(
    ALICE,
    {
      kind: "image",
      title: "wireframe",
      provenance: { agentId: "gateway", cardVersion: "1.0.0", model: "", sources: [] },
      body: raw,
      mimeType: "image/png",
    },
    store,
  );

  const out = await store.get(ALICE, artifact.id, 1);
  assert.deepEqual(out, raw);
  assert.equal(artifact.versions[0]!.bytes, raw.byteLength);
});
