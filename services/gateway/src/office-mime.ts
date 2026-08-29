import {
  MIME_SHEET,
  MIME_SLIDES,
  MIME_WORD,
  extensionForMime,
  isOfficeMime,
  isTextEditableMime,
} from "@alltheway/contracts";

export {
  MIME_SHEET,
  MIME_SLIDES,
  MIME_WORD,
  extensionForMime,
  isOfficeMime,
  isTextEditableMime,
};

export const WORK_FILES_CONNECTOR = "work_files";

export const WORK_FILES_TOOLS = {
  create_document: MIME_WORD,
  create_spreadsheet: MIME_SHEET,
  create_slides: MIME_SLIDES,
  create_pdf: "application/pdf",
  create_markdown: "text/markdown",
} as const;

export type WorkFilesTool = keyof typeof WORK_FILES_TOOLS;

export function isWorkFilesTool(tool: string): tool is WorkFilesTool {
  return tool in WORK_FILES_TOOLS;
}

export function officeFileLabel(mimeType: string): string {
  if (mimeType === MIME_WORD) return "Word document";
  if (mimeType === MIME_SHEET) return "spreadsheet";
  if (mimeType === MIME_SLIDES) return "PowerPoint";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "text/markdown" || mimeType === "text/plain") return "markdown note";
  return "file";
}
