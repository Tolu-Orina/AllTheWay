import express from "express";
import { z } from "zod";
import { HatSchema, HomeDocumentSchema, type HomeDocument } from "@alltheway/contracts";

import { requireUser } from "../auth.js";
import { authenticatingFetch } from "../a2a.js";
import { env } from "../env.js";
import { scopeHeader, scopeTokenConfigured } from "../scope.js";
import { documentsSlot } from "../repos/usage.js";
import { onDocumentReady } from "./life.js";

/**
 * Documents, proxied to the librarian.
 *
 * Thin on purpose. The librarian owns screening, extraction, chunking,
 * embedding and retrieval; this owns exactly one thing the librarian cannot
 * do — proving which user is asking.
 *
 * ## The uid never travels in a body or a path
 *
 * It travels in a signed scope token, and the librarian reads it from there.
 * There is deliberately no `uid` field in any request this file builds. That
 * is layer 4 of the isolation defence, and its purpose is to keep the set of
 * code that could cause a cross-tenant read down to one file rather than four
 * services.
 *
 * ## Two authentications, not one
 *
 * `authenticatingFetch` proves *this service* may call the librarian (Cloud
 * Run IAM). The scope token proves *which user* the call is for. They answer
 * different questions and neither substitutes for the other — dropping the
 * second would leave a service that may call the librarian for anybody.
 */

export const documentRoutes = express.Router();

const AUDIENCE = "librarian";

//: A long contract, not a video. Matched to the librarian's own ceiling so a
//: rejection happens here, with a clear message, rather than as an upstream
//: 413 the user cannot interpret.
const MAX_BYTES = 25 * 1024 * 1024;

//: Ingestion runs extraction, screening and embedding. Minutes, not seconds.
const INGEST_TIMEOUT_MS = 180_000;
const QUERY_TIMEOUT_MS = 30_000;

const UploadSchema = z.object({
  title: z.string().min(1).max(300),
  /** Base64, as with artifacts — one transport for the whole API. */
  content: z.string().min(1),
  mimeType: z.string().max(120).default("text/plain"),
  hat: HatSchema.nullable().optional(),
});

const RetrieveSchema = z.object({
  query: z.string().min(1).max(4000),
  limit: z.number().int().min(1).max(20).optional(),
});

function unavailable(res: express.Response): boolean {
  if (env.librarianUrl && scopeTokenConfigured()) return false;
  // A supported state, said plainly. Without a scope key nothing can be
  // scoped to a user, and serving documents unscoped is not an option.
  res.status(503).json({
    code: "not_configured",
    message: "Documents are not available in this environment.",
  });
  return true;
}

async function callLibrarian(
  uid: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const fetchImpl = authenticatingFetch(env.librarianUrl);
  return fetchImpl(`${env.librarianUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...scopeHeader(uid, AUDIENCE),
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Upstream errors are relayed with their meaning, not flattened to a 502. */
async function relay(res: express.Response, upstream: Response): Promise<void> {
  const body = await upstream.text();

  if (upstream.ok) {
    res.status(upstream.status).type("application/json").send(body || "{}");
    return;
  }

  if (upstream.status === 422) {
    // Screening refused it. That is the system working, and the user can act
    // on it — a 500 would say the opposite.
    let message = "That document could not be accepted.";
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) message = parsed.detail;
    } catch {
      /* keep the default */
    }
    res.status(422).json({ code: "blocked", message });
    return;
  }

  if (upstream.status === 413) {
    res.status(413).json({ code: "too_large", message: "That file is too large." });
    return;
  }

  if (upstream.status === 403) {
    let message = "Free keeps 5 documents. Delete one, or upgrade to Plus for 200.";
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) message = parsed.detail;
    } catch {
      /* keep the default */
    }
    res.status(403).json({ code: "plan_limit", message });
    return;
  }

  console.warn(`[documents] librarian returned HTTP ${upstream.status}`);
  res.status(502).json({
    code: "upstream_error",
    message: "The document service could not be reached.",
  });
}

documentRoutes.get("/", requireUser, async (req, res) => {
  if (unavailable(res)) return;
  try {
    await relay(res, await callLibrarian(req.uid!, "/documents", { method: "GET" }, QUERY_TIMEOUT_MS));
  } catch (err) {
    console.warn(`[documents] ${(err as Error).message}`);
    res.status(502).json({ code: "upstream_error", message: "The document service could not be reached." });
  }
});

/** Home's status row. Never blocks Today: empty if the librarian is slow. */
const HOME_DOCS_TIMEOUT_MS = 2_500;

export async function listHomeDocuments(uid: string): Promise<HomeDocument[]> {
  if (!env.librarianUrl || !scopeTokenConfigured()) return [];
  try {
    const upstream = await callLibrarian(uid, "/documents", { method: "GET" }, HOME_DOCS_TIMEOUT_MS);
    if (!upstream.ok) return [];
    const body = (await upstream.json()) as { documents?: unknown };
    const parsed = z.array(HomeDocumentSchema).safeParse(body.documents ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

documentRoutes.post("/", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const body = UploadSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "Expected a title and base64 content." });
  }

  // Sized here as well as upstream, so an oversized upload is refused before
  // it crosses the network rather than after.
  const bytes = Buffer.from(body.data.content, "base64").byteLength;
  if (bytes > MAX_BYTES) {
    return res.status(413).json({
      code: "too_large",
      message: `That is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.`,
    });
  }

  const slot = await documentsSlot(req.uid!);
  if (!slot.allowed) {
    return res.status(403).json({ code: "plan_limit", message: slot.message });
  }

  try {
    const upstream = await callLibrarian(
      req.uid!,
      "/documents",
      { method: "POST", body: JSON.stringify(body.data) },
      INGEST_TIMEOUT_MS,
    );
    const text = await upstream.text();
    if (upstream.ok) {
      let documentId = "";
      try {
        const parsed = JSON.parse(text) as { documentId?: string };
        documentId = typeof parsed.documentId === "string" ? parsed.documentId : "";
      } catch {
        /* librarian returned a non-JSON success — still relay it */
      }
      res.status(upstream.status).type("application/json").send(text || "{}");
      if (documentId) {
        void onDocumentReady(req.uid!, documentId, body.data.title).catch((err) => {
          console.warn(`[documents] propose after ingest: ${(err as Error).message}`);
        });
      }
      return;
    }
    await relay(
      res,
      new Response(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
      }),
    );
  } catch (err) {
    console.warn(`[documents] ingest failed: ${(err as Error).message}`);
    res.status(502).json({ code: "upstream_error", message: "That document could not be processed." });
  }
});

documentRoutes.delete("/:id", requireUser, async (req, res) => {
  if (unavailable(res)) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  try {
    await relay(res, await callLibrarian(req.uid!, `/documents/${encodeURIComponent(id)}`, { method: "DELETE" }, QUERY_TIMEOUT_MS));
  } catch (err) {
    console.warn(`[documents] delete failed: ${(err as Error).message}`);
    res.status(502).json({ code: "upstream_error", message: "That could not be deleted." });
  }
});

/**
 * Retrieval, exposed for the document library's own search.
 *
 * The orchestrator retrieves through its own path during a turn; this is for
 * a user searching their documents directly, which is a different question
 * with a different answer shape.
 */
documentRoutes.post("/search", requireUser, async (req, res) => {
  if (unavailable(res)) return;

  const body = RetrieveSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "Expected a query." });
  }

  try {
    await relay(
      res,
      await callLibrarian(req.uid!, "/retrieve", { method: "POST", body: JSON.stringify(body.data) }, QUERY_TIMEOUT_MS),
    );
  } catch (err) {
    console.warn(`[documents] search failed: ${(err as Error).message}`);
    res.status(502).json({ code: "upstream_error", message: "That search could not run." });
  }
});
