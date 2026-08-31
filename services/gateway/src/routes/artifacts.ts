import express from "express";
import { z } from "zod";

import { requireUser } from "../auth.js";
import {
  NotFound,
  addVersion,
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  renameArtifact,
} from "../repos/artifacts.js";
import { rememberVisual } from "../repos/visual.js";
import { artifactStore, storageConfigured } from "../storage.js";
import { previewBytes } from "../office-preview.js";
import { ArtifactPreviewSchema } from "@alltheway/contracts";
import { extensionForMime } from "../office-mime.js";

/**
 * Artifacts over HTTP.
 *
 * Every route is behind `requireUser` and every repository call takes the uid
 * from the *verified token*, never from the path or the body. There is
 * deliberately no `?uid=` anywhere in this file: a route that accepts an owner
 * is a route that can be handed the wrong one.
 *
 * The artifact id is never combined with a uid from the request. It is always
 * `artifacts(req.uid)`, so a guessed id belonging to another user resolves to
 * a document that does not exist rather than to someone else's work.
 */

export const artifactRoutes = express.Router();

//: A version is a document, a wireframe or a summary — not a video upload.
//: Generous enough for a long document, small enough that a mistake is not an
//: outage. Phase C raises it deliberately for generated media.
const MAX_BYTES = 10 * 1024 * 1024;

const CreateSchema = z.object({
  kind: z.enum(["doc", "image", "video", "summary", "checklist"]),
  title: z.string().min(1).max(200),
  sessionId: z.string().max(128).optional(),
  /** Base64. JSON is the transport for everything else here; a multipart
   *  special case for one route would be a second parsing path to secure. */
  content: z.string(),
  mimeType: z.string().max(120).default("text/markdown"),
  prompt: z.string().max(4000).optional(),
  producedBy: z.enum(["user", "agent"]).default("agent"),
});

const VersionSchema = z.object({
  content: z.string(),
  mimeType: z.string().max(120).default("text/markdown"),
  producedBy: z.enum(["user", "agent"]).default("user"),
  prompt: z.string().max(4000).optional(),
  correction: z.string().max(4000).optional(),
});

/** Express 5 types a param as string | string[]. The rest of the gateway
 *  narrows it the same way rather than casting, so a repeated param cannot
 *  arrive as an array and be used as an id. */
const param = (req: express.Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

const bad = (res: express.Response, message: string) =>
  res.status(400).json({ code: "invalid_request", message });

function decode(content: string, res: express.Response): Buffer | null {
  const body = Buffer.from(content, "base64");
  // Buffer.from silently produces garbage for invalid base64 rather than
  // throwing, so length is the only signal that the input was not what the
  // client believed it was sending.
  if (body.byteLength === 0 && content.length > 0) {
    bad(res, "The content could not be decoded. Expected base64.");
    return null;
  }
  if (body.byteLength > MAX_BYTES) {
    res.status(413).json({
      code: "too_large",
      message: `That is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit for one version.`,
    });
    return null;
  }
  return body;
}

function unavailable(res: express.Response): boolean {
  if (storageConfigured) return false;
  // A supported state, reported as such. The alternative — a 500 from deep in
  // the storage client — reads as a bug rather than as configuration.
  res.status(503).json({
    code: "not_configured",
    message: "Artifacts are not available in this environment.",
  });
  return true;
}

artifactRoutes.get("/", requireUser, async (req, res) => {
  const raw = req.query.sessionId;
  const sessionId = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  res.json(await listArtifacts(req.uid!, 50, sessionId));
});

artifactRoutes.get("/:id", requireUser, async (req, res) => {
  const artifact = await getArtifact(req.uid!, param(req, "id"));
  // 404, not 403, for an artifact belonging to someone else. The repository
  // scopes by uid, so another user's id is simply absent — and that is also
  // the right answer to give: confirming existence would leak it.
  if (!artifact) return res.status(404).json({ code: "not_found", message: "No such artifact." });
  res.json(artifact);
});

artifactRoutes.patch("/:id", requireUser, async (req, res) => {
  const body = z.object({ title: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) return bad(res, "Expected a title.");
  const next = body.data.title.trim();
  if (!next) return bad(res, "Expected a title.");
  try {
    const saved = await renameArtifact(req.uid!, param(req, "id"), next);
    res.json({ title: saved });
  } catch (err) {
    if (err instanceof NotFound) {
      return res.status(404).json({ code: "not_found", message: "No such artifact." });
    }
    throw err;
  }
});

artifactRoutes.post("/", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const body = CreateSchema.safeParse(req.body);
  if (!body.success) return bad(res, "Expected a kind, a title and base64 content.");

  const bytes = decode(body.data.content, res);
  if (!bytes) return;

  const artifact = await createArtifact(req.uid!, {
    kind: body.data.kind,
    title: body.data.title,
    sessionId: body.data.sessionId,
    body: bytes,
    mimeType: body.data.mimeType,
    prompt: body.data.prompt,
    producedBy: body.data.producedBy,
    provenance: {
      agentId: "gateway",
      // The card version of the agent that produced it. Phase 7's attribution
      // requirement asks for the published contract, not the build SHA.
      cardVersion: "1.0.0",
      model: "",
      sources: [],
    },
  });

  res.status(201).json(artifact);
});

artifactRoutes.post("/:id/versions", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const body = VersionSchema.safeParse(req.body);
  if (!body.success) return bad(res, "Expected base64 content.");

  const bytes = decode(body.data.content, res);
  if (!bytes) return;

  try {
    const n = await addVersion(req.uid!, param(req, "id"), {
      body: bytes,
      mimeType: body.data.mimeType,
      producedBy: body.data.producedBy,
      prompt: body.data.prompt,
      correction: body.data.correction,
    });
    const note = body.data.correction?.trim();
    if (note) {
      try {
        await rememberVisual(req.uid!, note);
      } catch (err) {
        // The version is the user's work and already landed. Brand memory is a
        // convenience: failing the save because a palette could not be
        // written would trade a small miss for a lost edit.
        console.error("[artifacts] rememberVisual", err);
      }
    }
    res.status(201).json({ n });
  } catch (err) {
    if (err instanceof NotFound) {
      return res.status(404).json({ code: "not_found", message: "No such artifact." });
    }
    throw err;
  }
});

/**
 * Export. Work that cannot leave is work you do not own.
 *
 * Defaults to the current version rather than requiring the caller to know
 * which that is — the common case is "give me the latest".
 */
artifactRoutes.get("/:id/export", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const artifact = await getArtifact(req.uid!, param(req, "id"));
  if (!artifact) return res.status(404).json({ code: "not_found", message: "No such artifact." });

  const requested = Number(req.query.version ?? artifact.currentVersion);
  const version = artifact.versions.find((v) => v.n === requested);
  if (!version) {
    return res.status(404).json({ code: "not_found", message: "No such version." });
  }

  const bytes = await artifactStore.get(req.uid!, param(req, "id"), version.n);

  // A filename the user recognises, sanitised: a title is user input, and it
  // is about to become a Content-Disposition header.
  const safeTitle = artifact.title.replace(/[^\w\d\-. ]+/g, "_").slice(0, 80) || "artifact";
  const ext = extensionForMime(version.mimeType);
  const filename = `${safeTitle}-v${version.n}${ext}`;
  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(bytes);
});

/**
 * A typed preview for the modal. Bytes stay on export; this is what a person
 * can actually read in the browser without pretending we are Word.
 */
artifactRoutes.get("/:id/preview", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const artifact = await getArtifact(req.uid!, param(req, "id"));
  if (!artifact) return res.status(404).json({ code: "not_found", message: "No such artifact." });

  const requested = Number(req.query.version ?? artifact.currentVersion);
  const version = artifact.versions.find((v) => v.n === requested);
  if (!version) {
    return res.status(404).json({ code: "not_found", message: "No such version." });
  }

  const bytes = await artifactStore.get(req.uid!, param(req, "id"), version.n);
  const preview = await previewBytes(version.mimeType, bytes);
  res.json(ArtifactPreviewSchema.parse(preview));
});

artifactRoutes.delete("/:id", requireUser, async (req, res) => {
  if (unavailable(res)) return;
  const deleted = await deleteArtifact(req.uid!, param(req, "id"));
  if (!deleted) return res.status(404).json({ code: "not_found", message: "No such artifact." });
  res.status(204).end();
});
