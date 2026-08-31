/**
 * Prepare a document for the JSON upload path.
 *
 * ChatGPT, Slack and WhatsApp all compress a camera photo before it crosses
 * the network. We do the same, then encode as base64 because that is still
 * the one transport this API uses. A phone photo that arrived as a 4MB HEIC
 * with an empty `type` used to become `text/plain` and a 413 — both of which
 * the client reported as "Something went wrong."
 */

export const DOCUMENT_ACCEPT =
  ".pdf,.txt,.md,.markdown,.docx,text/plain,text/markdown,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "image/jpeg,image/png,image/webp,image/heic,image/heif";

export const DOCUMENT_CAMERA_ACCEPT = "image/jpeg,image/png";

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Cloud Run's request ceiling is 32MB. Base64 of a 25MB file is ~33MB, so a
 * file that passes the decoded-size check can still fail on the wire. Refuse
 * locally with a sentence rather than a generic 413.
 */
const JSON_CEILING = 30 * 1024 * 1024;

const MIME_WORD =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXT: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: MIME_WORD,
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function mimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? null;
}

function mimeFromMagic(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (ftyp === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return brand === "mif1" || brand === "msf1" ? "image/heif" : "image/heic";
    }
  }
  return null;
}

export function normalizeMime(claimed: string, name: string, bytes: Uint8Array): string {
  const magic = mimeFromMagic(bytes);
  if (magic) return magic;

  let type = (claimed || "").toLowerCase().trim();
  if (type === "image/jpg") type = "image/jpeg";

  const fromName = mimeFromName(name);
  if (!type || type === "application/octet-stream" || type === "text/plain") {
    if (fromName) return fromName;
  }
  return type || fromName || "application/octet-stream";
}

export async function toBase64(bytes: Uint8Array): Promise<string> {
  // Chunked, because String.fromCharCode(...bytes) on a 25MB file blows the
  // argument limit and throws a RangeError that reads as a mystery.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

async function compressImage(file: Blob, mime: string): Promise<Blob | null> {
  if (mime === "image/heic" || mime === "image/heif") return null;
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 2048;
    let { width, height } = bitmap;
    if (width <= maxEdge && height <= maxEdge && file.size < 400_000) {
      bitmap.close();
      return null;
    }
    const scale = Math.min(1, maxEdge / width, maxEdge / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return blob && blob.size < file.size ? blob : null;
  } catch {
    return null;
  }
}

export async function prepareDocumentUpload(file: File): Promise<{
  title: string;
  content: string;
  mimeType: string;
}> {
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new Error(
      `${file.name || "That file"} is larger than ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)}MB.`,
    );
  }

  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime = normalizeMime(file.type, file.name, bytes);
  const title = file.name?.trim() || (mime.startsWith("image/") ? "photo.jpg" : "document");

  if (mime.startsWith("image/") && mime !== "image/heic" && mime !== "image/heif") {
    const compressed = await compressImage(file, mime);
    if (compressed) {
      bytes = new Uint8Array(await compressed.arrayBuffer());
      mime = compressed.type || "image/jpeg";
    }
  }

  const content = await toBase64(bytes);
  if (content.length > JSON_CEILING) {
    throw new Error(
      "That file is too large to send in one piece. Try a smaller PDF, or photograph the pages.",
    );
  }

  return { title, content, mimeType: mime };
}
