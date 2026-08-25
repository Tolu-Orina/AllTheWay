import express from "express";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";

import { issueCode, verifyCode } from "../codes.js";
import { createMailer } from "../mailer.js";
import { requireUser } from "../auth.js";

const mailer = createMailer();
export const authRoutes = express.Router();

const EmailSchema = z.object({ email: z.string().email() });
const CodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const ResetSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(8),
});

const bad = (res: express.Response, message: string) =>
  res.status(400).json({ code: "invalid_request", message });

/* ------------------------------------------------------------------ *
 * Email verification. Authenticated: the account exists, it is simply
 * not verified yet, so we take the address from the token rather than
 * the request body — a client cannot ask us to verify someone else.
 * ------------------------------------------------------------------ */

authRoutes.post("/send-code", requireUser, async (req, res) => {
  const user = await getAuth().getUser(req.uid!);
  if (!user.email) return bad(res, "This account has no email address.");
  if (user.emailVerified) return res.status(204).end();

  const issued = await issueCode(user.email, "verify_email");
  if (!issued.ok) {
    return res.status(429).json({
      code: "rate_limited",
      message: `A code was just sent. Try again in ${issued.retryInSeconds} seconds.`,
    });
  }

  await mailer.sendCode(user.email, issued.code, "verify_email");
  res.status(204).end();
});

authRoutes.post("/verify-code", requireUser, async (req, res) => {
  const body = CodeSchema.safeParse(req.body);
  if (!body.success) return bad(res, "Enter the six-digit code from your email.");

  const user = await getAuth().getUser(req.uid!);
  if (!user.email) return bad(res, "This account has no email address.");

  const result = await verifyCode(user.email, "verify_email", body.data.code);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "That code has expired. Send a new one."
        : result.reason === "too_many_attempts"
          ? "Too many attempts. Send a new code."
          : "That code is not right. Check it and try again.";
    return res.status(400).json({ code: "invalid_request", message });
  }

  // The Admin SDK is the only thing that can mark an address verified.
  await getAuth().updateUser(req.uid!, { emailVerified: true });
  res.status(204).end();
});

/* ------------------------------------------------------------------ *
 * Password reset. Unauthenticated by necessity — the user cannot sign
 * in. Both endpoints answer identically whether or not the account
 * exists, so they cannot be used to enumerate registered addresses.
 * ------------------------------------------------------------------ */

authRoutes.post("/reset-request", async (req, res) => {
  const body = EmailSchema.safeParse(req.body);
  if (!body.success) return bad(res, "Enter a valid email address.");

  try {
    await getAuth().getUserByEmail(body.data.email);
    const issued = await issueCode(body.data.email, "reset_password");
    if (issued.ok) await mailer.sendCode(body.data.email, issued.code, "reset_password");
  } catch {
    // No such user. Fall through to the same response deliberately.
  }

  res.status(204).end();
});

authRoutes.post("/reset-confirm", async (req, res) => {
  const body = ResetSchema.safeParse(req.body);
  if (!body.success) return bad(res, "Check the code and that the password is at least 8 characters.");

  const result = await verifyCode(body.data.email, "reset_password", body.data.code);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "That code has expired. Request a new one."
        : result.reason === "too_many_attempts"
          ? "Too many attempts. Request a new code."
          : "That code is not right. Check it and try again.";
    return res.status(400).json({ code: "invalid_request", message });
  }

  try {
    const user = await getAuth().getUserByEmail(body.data.email);
    await getAuth().updateUser(user.uid, { password: body.data.password });
  } catch {
    // The code was valid, so the account existed when it was issued. Say
    // nothing more specific than this.
    return res.status(400).json({ code: "invalid_request", message: "We could not reset that password." });
  }

  res.status(204).end();
});
