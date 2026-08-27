import express from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

import { env } from "../env.js";
import { db } from "../firestore.js";
import { requireUser } from "../auth.js";

/**
 * Connecting a Google account.
 *
 * The browser round-trip lives here because the gateway is the only service the
 * browser can reach. What the grant is *used for* lives in the connector
 * gateway, which the browser deliberately cannot reach at all — that separation
 * is enforced by IAM, not by this code being careful.
 *
 * ## One redirect URI for every connector
 *
 * Google requires each redirect URI to be registered by hand, so four
 * connectors could mean four console entries that drift. Instead there is one,
 * and `state` says which connector the user was connecting.
 *
 * `state` is not decoration. It is a random value stored server-side against
 * the signed-in user, and it does two jobs:
 *
 *   - it carries the identity, because Google's redirect arrives as a plain
 *     browser GET with no Authorization header
 *   - it is the CSRF defence, because without it anyone could hand a user a
 *     callback URL carrying an attacker's authorization code and quietly bind
 *     the attacker's Google account to that user
 *
 * It is single-use and short-lived, for the same reason a verification code is.
 *
 * ## Scopes are asked for as a union, once
 *
 * Google issues one refresh token per (client, user), and a later
 * authorisation supersedes an earlier one. Asking for Calendar now and Gmail
 * later — as separate requests — leaves a grant that covers only the later.
 * Requesting the union with `include_granted_scopes` makes connecting a second
 * connector additive rather than destructive.
 */

export const connectorRoutes = express.Router();

const STATE_TTL_MS = 10 * 60_000;

/**
 * What the consent screen asks for.
 *
 * The authority on which scopes a *call* requires is the connector gateway's
 * `catalogue.py`; this is the request side. The two are declared separately
 * because the browser-facing service has no IAM path to the connector gateway
 * and should not be given one just to read a list.
 *
 * That split is safe in the direction it can fail: if this asks for too little,
 * enforcement refuses the call with "you have not granted this", which the user
 * can act on. It cannot silently allow anything, because nothing here decides
 * what a call is permitted to do.
 *
 * Restricted scopes are deliberately absent — `gmail.readonly` and
 * `gmail.compose` need a CASA security assessment, and including one makes the
 * whole consent screen fail rather than just that scope.
 */
const GOOGLE_SCOPES = [
  // Meetings, read-only. Tier 1 reads a conference record and its transcript
  // after the call; nothing here can start, join or alter a meeting.
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
] as const;

/**
 * Restricted, and therefore requested only when the user explicitly asks.
 *
 * `gmail.compose` is what `users.drafts.create` needs — there is no narrower
 * scope for drafting, which is awkward given a draft is the *safest* thing this
 * connector does and is exactly what a DRAFT_ONLY ceiling wants.
 *
 * It is usable today: an app in Testing mode may request restricted scopes for
 * its listed test users with no verification. The bill arrives at publication,
 * as verification plus an annual CASA assessment. Keeping it opt-in means that
 * bill is a decision rather than a surprise, and that users who only want
 * sending are never shown a scarier consent screen than they need.
 */
const GMAIL_DRAFTS_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Mirrors the connector gateway's catalogue for display only. */
const CATALOGUE = [
  { id: "google_calendar", label: "Google Calendar", provider: "google", status: "available" },
  { id: "google_gmail", label: "Gmail", provider: "google", status: "available" },
  { id: "google_drive", label: "Google Drive", provider: "google", status: "available" },
  { id: "google_docs", label: "Google Docs", provider: "google", status: "available" },
  { id: "github", label: "GitHub", provider: "github", status: "coming_soon" },
  { id: "notion", label: "Notion", provider: "notion", status: "coming_soon" },
  { id: "slack", label: "Slack", provider: "slack", status: "coming_soon" },
] as const;

const grants = () => db.collection("connectorGrants");
const states = () => db.collection("connectorStates");

/**
 * Where Google sends the browser back.
 *
 * Derived from the first configured web origin rather than configured again,
 * so it cannot disagree with the site the user is actually on. It must match
 * a URI registered on the OAuth client exactly, including the scheme and any
 * trailing path.
 */
function redirectUri(): string {
  const origin = env.webOrigins[0];
  if (!origin) throw new Error("WEB_ORIGINS is empty; cannot build a redirect URI.");
  return `${origin}/api/connectors/google/callback`;
}

/* ------------------------------------------------------------------ *
 * Listing. Authenticated: whether an account is connected is not
 * something an anonymous caller should be able to probe.
 * ------------------------------------------------------------------ */

connectorRoutes.get("/", requireUser, async (req, res) => {
  const doc = await grants().doc(`${req.uid!}::google`).get();
  const scopes: string[] = doc.exists ? (doc.get("scopes") ?? []) : [];

  res.json({
    connectors: CATALOGUE.map((c) => ({
      ...c,
      // Only providers we actually support can be connected; the rest report
      // false rather than being absent, so the UI has one shape to render.
      connected: c.provider === "google" && doc.exists,
    })),
    grantedScopes: scopes,
  });
});

/* ------------------------------------------------------------------ *
 * Starting consent.
 * ------------------------------------------------------------------ */

connectorRoutes.post("/google/connect", requireUser, async (req, res) => {
  // Mounted by Cloud Run from Secret Manager, exactly as the mail key is —
  // so the value never appears in Terraform state or the revision spec.
  const clientId = env.googleOAuthClientId;
  if (!clientId) {
    return res.status(503).json({
      code: "not_configured",
      message: "Connecting a Google account is not available yet.",
    });
  }

  // 32 bytes from a CSPRNG. This is a credential: it is what proves the
  // callback belongs to this user's session.
  const state = randomBytes(32).toString("base64url");
  const connector = typeof req.body?.connector === "string" ? req.body.connector : "";
  const wantsDrafts = req.body?.drafts === true;
  const scopes = wantsDrafts ? [...GOOGLE_SCOPES, GMAIL_DRAFTS_SCOPE] : [...GOOGLE_SCOPES];

  await states().doc(state).set({
    uid: req.uid,
    connector,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
  });

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  // Both are required to get a refresh token at all: Google returns one only
  // on the first consent unless prompted, and an access-token-only grant would
  // stop working an hour later with no way to renew it.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // Keeps previously granted scopes when a user connects a second connector.
  url.searchParams.set("include_granted_scopes", "true");

  res.json({ url: url.toString() });
});

/* ------------------------------------------------------------------ *
 * The callback. Deliberately NOT behind requireUser: it is a browser
 * redirect from Google carrying no Authorization header. `state` is
 * what authenticates it.
 * ------------------------------------------------------------------ */

connectorRoutes.get("/google/callback", async (req, res) => {
  const done = (status: string) =>
    res.redirect(`${env.webOrigins[0] ?? ""}/app/you?connected=${status}`);

  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";

  if (!state || !code) return done("failed");

  const stateRef = states().doc(state);
  const stateDoc = await stateRef.get();
  // Single use, always — deleted whether or not the rest succeeds, so a state
  // value cannot be replayed after a failure.
  await stateRef.delete().catch(() => undefined);

  if (!stateDoc.exists) return done("failed");

  const expiresAt = stateDoc.get("expiresAt") as Timestamp | undefined;
  if (!expiresAt || expiresAt.toMillis() < Date.now()) return done("expired");

  const uid = stateDoc.get("uid");
  if (typeof uid !== "string" || !uid) return done("failed");

  const { googleOAuthClientId: clientId, googleOAuthClientSecret: clientSecret } = env;
  if (!clientId || !clientSecret) return done("failed");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.warn(`[connectors] token exchange failed: HTTP ${response.status}`);
    return done("failed");
  }

  const payload = (await response.json()) as {
    refresh_token?: string;
    scope?: string;
  };

  if (!payload.refresh_token) {
    // Google omits it when a grant already exists and `prompt=consent` was not
    // honoured. Without it there is nothing durable to store, and pretending
    // otherwise would produce a connector that works for an hour.
    console.warn("[connectors] no refresh token returned; grant not stored");
    return done("retry");
  }

  await grants().doc(`${uid}::google`).set({
    refreshToken: payload.refresh_token,
    // Recorded because a user can untick a scope on the consent screen. Without
    // this, the first sign is a 403 from Google, which reads as a broken
    // connector rather than as a permission they declined.
    scopes: (payload.scope ?? "").split(" ").filter(Boolean),
    updatedAt: FieldValue.serverTimestamp(),
  });

  done("google");
});
