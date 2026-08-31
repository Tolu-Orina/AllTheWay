import type { ThreadAttachment } from "@alltheway/contracts";

import { artifactFileRef, type TurnFile } from "./repos/artifacts.js";

/**
 * Files for this turn, as the model should see them.
 *
 * Not retrieved chunks. The person attached these just now; Vertex reads
 * the PDF or image on the planning call. The librarian indexes them later.
 */
export async function filesForTurn(
  uid: string,
  attachments: ThreadAttachment[],
): Promise<TurnFile[]> {
  const out: TurnFile[] = [];
  for (const attachment of attachments.slice(0, 5)) {
    if (!attachment.artifactId) {
      out.push({ name: attachment.name, mime: attachment.mime || "application/octet-stream" });
      continue;
    }
    const file = await artifactFileRef(uid, attachment.artifactId, attachment.name);
    if (file) out.push(file);
  }
  return out;
}
