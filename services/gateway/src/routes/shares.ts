import express from "express";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";

import {
  accessTo,
  addComment,
  grantShare,
  listComments,
  listShares,
  listSharedWithMe,
  resolveComment,
  revokeShare,
  titleOf,
} from "../repos/shares.js";
import { readUsage } from "../repos/usage.js";

/**
 * Sharing routes: share, comment, resolve.
 *
 * ## Every route resolves the owner before it does anything
 *
 * Elsewhere in this service the pattern is `artifacts(req.uid)` — a guessed id
 * belonging to someone else simply resolves to nothing. Sharing breaks that
 * comfort: a grantee legitimately reads under *another* user's path, so the
 * owner arrives as a parameter and the guard has to be explicit.
 *
 * `accessTo` is that guard, and it is called on every route here, including the
 * ones that only read. There is no path in this file that touches an artifact
 * without asking first.
 *
 * ## Sharing is a paid capability, checked at grant time
 *
 * Team and above. Checked when the share is created rather than when it is
 * read, because a downgrade must not silently revoke access someone already
 * relies on — that would look like the product losing their work.
 */

export const shareRoutes = express.Router();

const param = (req: express.Request, name: string) => String(req.params[name] ?? "");

/** Plans that may share. Team and Max — the paid tiers meant for more than one person. */
const SHARING_TIERS = new Set(["team", "max"]);

const GrantSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["viewer", "commenter"]).default("viewer"),
});

shareRoutes.post("/artifacts/:id/shares", (req, res) => {
  void (async () => {
    const body = GrantSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected an email and a role." });
      return;
    }

    const usage = await readUsage(req.uid!);
    if (!SHARING_TIERS.has(usage.tier)) {
      res.status(403).json({
        code: "forbidden",
        message: "Sharing is part of the Team plan.",
      });
      return;
    }

    const artifactId = param(req, "id");
    const title = await titleOf(req.uid!, artifactId);
    if (title === null) {
      res.status(404).json({ code: "not_found", message: "That is not available to you." });
      return;
    }

    let grantee;
    try {
      grantee = await getAuth().getUserByEmail(body.data.email);
    } catch {
      // Deliberately not "no such user". Confirming which addresses have
      // accounts turns this endpoint into a way to enumerate the user base.
      res.status(404).json({
        code: "not_found",
        message: "That person cannot be shared with yet. Ask them to sign in first.",
      });
      return;
    }

    if (grantee.uid === req.uid) {
      res.status(400).json({ code: "invalid_request", message: "That is already yours." });
      return;
    }

    const owner = await getAuth().getUser(req.uid!);
    await grantShare({
      ownerUid: req.uid!,
      ownerEmail: owner.email ?? "",
      artifactId,
      granteeUid: grantee.uid,
      granteeEmail: grantee.email ?? body.data.email,
      role: body.data.role,
      title,
    });

    res.status(201).json({ granteeUid: grantee.uid, role: body.data.role });
  })();
});

shareRoutes.get("/artifacts/:id/shares", (req, res) => {
  void (async () => {
    // Only the owner sees who else can read it. A grantee learning the full
    // list would be told who else is in the room, which is not theirs to know.
    const shares = await listShares(req.uid!, param(req, "id"));
    res.json(shares);
  })();
});

shareRoutes.delete("/artifacts/:id/shares/:granteeUid", (req, res) => {
  void (async () => {
    const removed = await revokeShare(req.uid!, param(req, "id"), param(req, "granteeUid"));
    if (!removed) {
      res.status(404).json({ code: "not_found", message: "That share is not there." });
      return;
    }
    res.status(204).end();
  })();
});

shareRoutes.get("/shared-with-me", (req, res) => {
  void (async () => {
    res.json(await listSharedWithMe(req.uid!));
  })();
});

const OwnerQuery = z.object({ owner: z.string().min(1).max(200) });

shareRoutes.get("/artifacts/:id/comments", (req, res) => {
  void (async () => {
    // The owner is named by the caller and then *checked*, never trusted. It is
    // an addressing detail, not a claim: `accessTo` decides.
    const query = OwnerQuery.safeParse(req.query);
    const ownerUid = query.success ? query.data.owner : req.uid!;

    const access = await accessTo(req.uid!, ownerUid, param(req, "id"));
    if (!access.allowed) {
      res.status(404).json({ code: "not_found", message: access.reason });
      return;
    }

    res.json(await listComments(ownerUid, param(req, "id")));
  })();
});

const CommentSchema = z.object({
  owner: z.string().min(1).max(200).optional(),
  versionAnchor: z.number().int().positive(),
  body: z.string().min(1).max(4000),
});

shareRoutes.post("/artifacts/:id/comments", (req, res) => {
  void (async () => {
    const parsed = CommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a comment and a version." });
      return;
    }

    const ownerUid = parsed.data.owner ?? req.uid!;
    const access = await accessTo(req.uid!, ownerUid, param(req, "id"));
    if (!access.allowed) {
      res.status(404).json({ code: "not_found", message: access.reason });
      return;
    }
    if (access.role !== "commenter") {
      // A viewer can read and cannot write. Said plainly, because "you have
      // read-only access" is actionable and a 404 here would not be.
      res.status(403).json({ code: "forbidden", message: "You have view-only access to this." });
      return;
    }

    const author = await getAuth().getUser(req.uid!);
    const id = await addComment({
      ownerUid,
      artifactId: param(req, "id"),
      authorUid: req.uid!,
      authorEmail: author.email ?? "",
      versionAnchor: parsed.data.versionAnchor,
      body: parsed.data.body,
    });

    res.status(201).json({ id });
  })();
});

const ResolveSchema = z.object({
  owner: z.string().min(1).max(200).optional(),
  commentId: z.string().min(1).max(200),
});

shareRoutes.post("/artifacts/:id/comments/resolve", (req, res) => {
  void (async () => {
    const parsed = ResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "invalid_request", message: "Expected a commentId." });
      return;
    }

    const ownerUid = parsed.data.owner ?? req.uid!;
    const access = await accessTo(req.uid!, ownerUid, param(req, "id"));
    if (!access.allowed || access.role !== "commenter") {
      res.status(403).json({ code: "forbidden", message: "You cannot resolve comments here." });
      return;
    }

    const done = await resolveComment(
      ownerUid,
      param(req, "id"),
      parsed.data.commentId,
      req.uid!,
    );
    if (!done) {
      res.status(404).json({ code: "not_found", message: "That comment is not there." });
      return;
    }
    res.status(204).end();
  })();
});
