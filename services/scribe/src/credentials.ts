import { getFirestore } from "firebase-admin/firestore";

/**
 * The user's own Meet credential.
 *
 * ## Why the user's and not the service's
 *
 * A transcript belongs to the people who were in the room. Reading it with the
 * service's identity would mean the service could read any meeting it could
 * name, and the only thing standing between users would be our own code being
 * correct. Reading it with the user's grant means Google enforces the boundary
 * too: a token minted from Ada's refresh token cannot fetch Bo's meeting, no
 * matter what this service asks for.
 *
 * That is the same reasoning as the connector gateway's, and it reads from the
 * same store the gateway's consent callback writes — `connectorGrants`, keyed
 * `{uid}::{provider}`. Deliberately the same collection rather than a second
 * copy: two grant stores would drift, and the drift would show up as a user who
 * disconnected Google still having a working token somewhere.
 *
 * ## Short-lived, never stored
 *
 * The refresh token is exchanged at the moment of use and the access token is
 * kept only for that call. Storing access tokens would add a second thing to
 * leak in exchange for saving one HTTP round trip per meeting.
 */

export class NotConnected extends Error {}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const GRANTS = "connectorGrants";
const PROVIDER = "google";

export async function accessTokenFor(uid: string): Promise<string> {
  const doc = await getFirestore().collection(GRANTS).doc(`${uid}::${PROVIDER}`).get();
  if (!doc.exists) {
    throw new NotConnected("This account has not connected Google Meet.");
  }

  const refreshToken = doc.get("refreshToken");
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new NotConnected("This account has not connected Google Meet.");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    // A configuration fault, said as one. Reporting it as "not connected" would
    // send the user to reconnect an account that is already connected.
    throw new Error("The Google OAuth client is not configured for this service.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !body.access_token) {
    // A revoked grant comes back as invalid_grant. That is the user having
    // disconnected, not a broken service, and the wording says so.
    if (body.error === "invalid_grant") {
      throw new NotConnected("Google access was revoked. Reconnect to take meeting notes.");
    }
    throw new Error(`Could not exchange the Google token (${body.error ?? response.status}).`);
  }

  return body.access_token;
}
