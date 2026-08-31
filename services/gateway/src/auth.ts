import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";

import { env } from "./env.js";
import { firstNameFrom } from "./name.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
    }
  }
}

/**
 * Who is on the other end of this token, including a first name we can say.
 *
 * Shared by HTTP (`Authorization` header) and the voice socket (first
 * message). Browsers cannot set headers on `new WebSocket()`, so the socket
 * cannot reuse the header path; the check itself must still be the same.
 *
 * This is the real security boundary. The client-side route guard is UX only.
 * Returns null rather than throwing: the caller chooses 401 vs close.
 */
export type Caller = { uid: string; firstName: string };

export async function callerFromToken(token: string | undefined): Promise<Caller | null> {
  if (env.allowAnonymous) return { uid: env.devUserId, firstName: "" };
  if (!token) return null;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      firstName: firstNameFrom({
        name: typeof decoded.name === "string" ? decoded.name : undefined,
        email: typeof decoded.email === "string" ? decoded.email : undefined,
      }),
    };
  } catch {
    return null;
  }
}

export async function uidFromToken(token: string | undefined): Promise<string | null> {
  return (await callerFromToken(token))?.uid ?? null;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  const uid = await uidFromToken(token);

  if (!uid) {
    res.status(401).json({
      code: "unauthenticated",
      message: token
        ? "Your session has expired. Sign in again."
        : "Sign in to continue.",
    });
    return;
  }

  req.uid = uid;
  next();
}
