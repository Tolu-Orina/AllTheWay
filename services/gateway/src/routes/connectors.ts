import express from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

import { env } from "../env.js";
import { db, userDoc } from "../firestore.js";
import { requireUser } from "../auth.js";
import {
  GOOGLE_CONNECTOR_IDS,
  googleGrantId,
  gmailDraftsOn,
  listedGoogleConnectors,
  scopesToRequest,
} from "../google-scopes.js";

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
 * ## Scopes are asked for per connector, then kept additive
 *
 * Google issues one refresh token per (client, user). Requesting Calendar
 * now and Gmail later as separate *full-union* requests is what made every
 * Google row look connected after a single tap — the consent screen asked for
 * everything, and the listing treated "a Google grant exists" as "every Google
 * connector is connected".
 *
 * Each tap now asks only for that connector's scopes. `include_granted_scopes`
 * keeps earlier grants when a second connector is added, so connecting Gmail
 * after Calendar adds Gmail rather than replacing Calendar.
 */

export const connectorRoutes = express.Router();

const STATE_TTL_MS = 10 * 60_000;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Mirrors the connector gateway's catalogue for display only. */
const CATALOGUE = [
  { id: "google_calendar", label: "Google Calendar", provider: "google", status: "available" },
  { id: "google_gmail", label: "Gmail", provider: "google", status: "available" },
  { id: "google_drive", label: "Google Drive", provider: "google", status: "available" },
  { id: "google_docs", label: "Google Docs", provider: "google", status: "available" },
  { id: "google_meet", label: "Google Meet", provider: "google", status: "available" },
  { id: "slack", label: "Slack", provider: "slack", status: "coming_soon" },
  { id: "notion", label: "Notion", provider: "notion", status: "coming_soon" },
  { id: "github", label: "GitHub", provider: "github", status: "coming_soon" },
  { id: "microsoft_teams", label: "Microsoft Teams", provider: "microsoft", status: "coming_soon" },
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

function safeReturnTo(value: unknown): "/app" | "/app/you" {
  return value === "/app" || value === "/app/you" ? value : "/app/you";
}

/* ------------------------------------------------------------------ *
 * Listing. Authenticated: whether an account is connected is not
 * something an anonymous caller should be able to probe.
 * ------------------------------------------------------------------ */

connectorRoutes.get("/", requireUser, async (req, res) => {
  const uid = req.uid!;
  const [doc, user] = await Promise.all([
    grants().doc(googleGrantId(uid)).get(),
    userDoc(uid).get(),
  ]);
  const scopes: string[] = doc.exists ? (doc.get("scopes") ?? []) : [];
  const declared = doc.exists ? (doc.get("connectors") as string[] | undefined) : undefined;
  const listed = new Set(listedGoogleConnectors(scopes, declared));
  const wantDrafts = user.exists && user.get("gmailDrafts") === true;

  res.json({
    connectors: CATALOGUE.map((c) => ({
      ...c,
      // Per connector they actually connected. Extra scopes on the token
      // (an older union request, or include_granted_scopes) must not tick
      // a row they never tapped.
      connected: listed.has(c.id),
    })),
    grantedScopes: scopes,
    drafts: gmailDraftsOn(scopes, wantDrafts),
  });
});

connectorRoutes.post("/gmail-drafts", requireUser, async (req, res) => {
  const drafts = req.body?.drafts === true;
  await userDoc(req.uid!).set({ gmailDrafts: drafts }, { merge: true });
  res.json({ drafts });
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
  const returnTo = safeReturnTo(req.body?.returnTo);

  if (!GOOGLE_CONNECTOR_IDS.includes(connector)) {
    return res.status(400).json({
      code: "invalid_request",
      message: "Choose which Google account to connect.",
    });
  }

  const user = await userDoc(req.uid!).get();
  const wantDrafts =
    wantsDrafts || (user.exists && user.get("gmailDrafts") === true);
  const scopes = scopesToRequest(connector, wantDrafts);

  await states().doc(state).set({
    uid: req.uid,
    connector,
    returnTo,
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
  const origin = env.webOrigins[0] ?? "";
  let returnTo: "/app" | "/app/you" = "/app/you";
  const done = (status: string) =>
    res.redirect(`${origin}${returnTo}?connected=${status}`);

  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";

  if (!state || !code) return done("failed");

  const stateRef = states().doc(state);
  const stateDoc = await stateRef.get();
  // Single use, always — deleted whether or not the rest succeeds, so a state
  // value cannot be replayed after a failure.
  await stateRef.delete().catch(() => undefined);

  if (!stateDoc.exists) return done("failed");
  returnTo = safeReturnTo(stateDoc.get("returnTo"));

  const expiresAt = stateDoc.get("expiresAt") as Timestamp | undefined;
  if (!expiresAt || expiresAt.toMillis() < Date.now()) return done("expired");

  const uid = stateDoc.get("uid");
  if (typeof uid !== "string" || !uid) return done("failed");
  const requested = stateDoc.get("connector");
  const connectedId =
    typeof requested === "string" && GOOGLE_CONNECTOR_IDS.includes(requested)
      ? requested
      : "google";

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

  const grantRef = grants().doc(googleGrantId(uid));
  const existing = await grantRef.get();
  const previousToken = existing.exists
    ? (existing.get("refreshToken") as string | undefined)
    : undefined;
  const refreshToken = payload.refresh_token ?? previousToken;

  if (!refreshToken) {
    // Google omits it when a grant already exists and `prompt=consent` was not
    // honoured. A first connect has nothing durable to store. A second connector
    // can keep the token already on the grant and still record the new scopes.
    console.warn("[connectors] no refresh token returned; grant not stored");
    return done("retry");
  }

  const previous = existing.exists
    ? ((existing.get("scopes") as string[] | undefined) ?? [])
    : [];
  const incoming = (payload.scope ?? "").split(" ").filter(Boolean);
  const scopes = [...new Set([...previous, ...incoming])];
  const previousDeclared = existing.exists
    ? ((existing.get("connectors") as string[] | undefined) ?? undefined)
    : undefined;
  // First write of this field is only the connector they just connected — not
  // inferred from scopes. Inferring would re-tick every Google row for anyone
  // whose earlier consent asked for the union.
  const connectors =
    connectedId === "google"
      ? previousDeclared
      : [...new Set([...(Array.isArray(previousDeclared) ? previousDeclared : []), connectedId])];

  await grantRef.set({
    refreshToken,
    // Recorded because a user can untick a scope on the consent screen. Without
    // this, the first sign is a 403 from Google, which reads as a broken
    // connector rather than as a permission they declined.
    //
    // Unioned with what was already stored: `include_granted_scopes` should
    // return the full set, but a missing scope on the token response must not
    // silently un-tick a connector that was connected last week.
    scopes,
    ...(Array.isArray(connectors) ? { connectors } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  done(connectedId);
});
