import type { ThreadAttachment } from "@alltheway/contracts";

import { api } from "@/app/data";
import { prepareDocumentUpload } from "@/lib/document-file";

/**
 * Files on the Work composer.
 *
 * They sit here until Ask. Attaching used to upload and immediately send a
 * canned "I've added X" turn — which meant a paperclip was a send button,
 * and the model was asked about a file the person had not yet questioned.
 */

export const WORK_ATTACH_MAX_FILES = 5;
export const WORK_ATTACH_MAX_BYTES = 5 * 1024 * 1024;

export type StagedFile = {
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
};

export type StageIssue =
  | { code: "tooMany" }
  | { code: "tooLarge"; name: string }
  | { code: "empty"; name: string };

const committed = new Map<string, ThreadAttachment[]>();

let seq = 0;
function nextId(): string {
  seq += 1;
  return `att-${seq}-${Date.now().toString(36)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function addStagedFiles(
  current: StagedFile[],
  incoming: File[],
): { next: StagedFile[]; issue: StageIssue | null } {
  const next = current.slice();
  let issue: StageIssue | null = null;
  for (const file of incoming) {
    if (next.length >= WORK_ATTACH_MAX_FILES) {
      issue = { code: "tooMany" };
      break;
    }
    const name = file.name?.trim() || "document";
    if (file.size > WORK_ATTACH_MAX_BYTES) {
      issue = { code: "tooLarge", name };
      continue;
    }
    if (!file.size) {
      issue = { code: "empty", name };
      continue;
    }
    next.push({
      id: nextId(),
      file,
      name,
      mime: file.type || "",
      size: file.size,
    });
  }
  return { next, issue };
}

export function stashCommitted(sessionId: string, files: ThreadAttachment[]): void {
  if (files.length) committed.set(sessionId, files);
}

export function takeCommitted(sessionId: string): ThreadAttachment[] {
  const files = committed.get(sessionId) ?? [];
  committed.delete(sessionId);
  return files;
}

function artifactKind(mime: string): "doc" | "image" {
  return mime.startsWith("image/") ? "image" : "doc";
}

/**
 * Keep a copy on this session's artifacts rail. The model reads the file
 * on this turn as an attachment. Librarian indexing happens overnight, so
 * Ask is not blocked on extraction and embeddings.
 */
export async function commitStaged(
  sessionId: string,
  files: StagedFile[],
): Promise<ThreadAttachment[]> {
  const out: ThreadAttachment[] = [];
  for (const staged of files) {
    const prepared = await prepareDocumentUpload(staged.file);
    const artifact = await api.attachToSession({
      sessionId,
      kind: artifactKind(prepared.mimeType),
      title: prepared.title,
      content: prepared.content,
      mimeType: prepared.mimeType,
    });
    out.push({
      name: prepared.title,
      mime: prepared.mimeType,
      size: staged.size,
      artifactId: artifact.id,
    });
  }
  return out;
}
