import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";

import { env } from "./env.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
    }
  }
}

/**
 * Verifies the caller's Firebase ID token and attaches the uid.
 *
 * This is the real security boundary. The client-side route guard is UX only —
 * anyone can edit their own JavaScript, so every request is authorised here
 * regardless of what the browser believes.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if (env.allowAnonymous) {
    req.uid = env.devUserId;
    next();
    return;
  }

  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ code: "unauthenticated", message: "Sign in to continue." });
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    // Deliberately vague: distinguishing expired from malformed tells an
    // attacker which half of their guess was right.
    res.status(401).json({ code: "unauthenticated", message: "Your session has expired. Sign in again." });
  }
}
