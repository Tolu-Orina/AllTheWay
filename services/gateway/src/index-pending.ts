/**
 * Overnight index of user-attached artifacts.
 *
 * Ask does not wait for the librarian. The model already read the file as a
 * Gemini part. This sweep, once a night, extracts, screens, chunks and
 * embeds so later turns (and preference-style retrieval) can use them.
 *
 * Users are enumerated the same way the morning digest is: a system process
 * walking the users collection, then path-scoped work under each uid.
 */

import { db } from "./firestore.js";
import { listPendingIndex, markIndexed } from "./repos/artifacts.js";
import { ingestUserDocument } from "./routes/documents.js";
import { artifactStore } from "./storage.js";

const MAX_USERS = 200;
const MAX_PER_USER = 4;

export async function sweepPendingIndex(): Promise<{ users: number; indexed: number; failed: number }> {
  let users = 0;
  let indexed = 0;
  let failed = 0;
  const snap = await db.collection("users").limit(MAX_USERS).get();
  for (const user of snap.docs) {
    users += 1;
    const pending = await listPendingIndex(user.id, MAX_PER_USER);
    for (const item of pending) {
      try {
        const n = Math.max(1, item.currentVersion);
        const body = await artifactStore.get(user.id, item.id, n);
        const documentId = await ingestUserDocument(user.id, {
          title: item.title,
          mimeType: item.mimeType,
          content: body.toString("base64"),
          hat: "work",
        });
        if (documentId) {
          await markIndexed(user.id, item.id, documentId);
          indexed += 1;
        } else {
          failed += 1;
        }
      } catch (err) {
        failed += 1;
        console.warn(
          `[index-pending] ${user.id} ${item.id}: ${(err as Error).message}`.slice(0, 240),
        );
      }
    }
  }
  return { users, indexed, failed };
}
