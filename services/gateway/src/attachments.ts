import { ThreadAttachmentSchema, type ThreadAttachment } from "@alltheway/contracts";
import { z } from "zod";

const ListSchema = z.array(ThreadAttachmentSchema).max(5);

/**
 * Attachments on a streamed turn travel in the query string because the
 * stream is GET (the token stays in a header). Five file metas fit; a
 * payload that does not parse is ignored rather than failing the turn.
 */
export function parseTurnAttachments(raw: unknown): ThreadAttachment[] {
  if (typeof raw !== "string" || !raw || raw.length > 8000) return [];
  try {
    const parsed = ListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function documentIdsOf(attachments: ThreadAttachment[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const id = attachment.documentId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 5) break;
  }
  return ids;
}
