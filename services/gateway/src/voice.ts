import { env } from "./env.js";

/**
 * Ephemeral credentials for a voice session.
 *
 * ## Why the browser never gets a real key
 *
 * The Live API session runs browser-to-Google, which means *something* has to
 * be in the browser. If that something is a long-lived API key or a service
 * account, then anyone who opens devtools on any user's machine holds a
 * credential that works everywhere, for everyone, until it is manually rotated.
 *
 * So the gateway mints a token that is:
 *
 *   - short-lived      minutes, not months
 *   - single-session   bound to one session id
 *   - user-authorised  only issued against a valid Firebase ID token
 *
 * Stealing one buys the thief the rest of a session they were already in.
 *
 * ## Why this is behind an interface
 *
 * Minting a real ephemeral token requires Vertex credentials, which do not
 * exist in development. The fake mints something structurally identical and
 * obviously useless, so the whole flow — auth, TTL, refusal, the browser code
 * that consumes it — runs and is tested with no GCP project. The real minter is
 * one environment variable away and changes nothing above this file.
 */

export type EphemeralToken = {
  /** Opaque to the client; handed straight to the Live API. */
  token: string;
  /** ISO-8601. The client refreshes before this, or the session ends. */
  expiresAt: string;
  model: string;
  /** Marks a token that cannot reach a real model, so nothing pretends it can. */
  fake?: true;
};

export interface TokenMinter {
  mint(sessionId: string, userId: string): Promise<EphemeralToken>;
}

/** Minutes, not hours. A stolen token should expire before it is useful. */
const TTL_SECONDS = 10 * 60;

function expiry(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

class FakeTokenMinter implements TokenMinter {
  async mint(sessionId: string, userId: string): Promise<EphemeralToken> {
    // Deliberately not a plausible credential. If this ever reaches a real
    // endpoint it fails loudly rather than half-working, and it cannot be
    // mistaken for something worth stealing.
    return {
      token: `fake-live-token.${sessionId}.${userId.slice(0, 6)}.${Date.now()}`,
      expiresAt: expiry(TTL_SECONDS),
      model: env.liveModel,
      fake: true,
    };
  }
}

class VertexTokenMinter implements TokenMinter {
  async mint(sessionId: string, _userId: string): Promise<EphemeralToken> {
    // Deliberately unimplemented rather than approximated.
    //
    // Vertex mints Live API auth tokens through the GenAI SDK, scoped and
    // time-boxed by the service's own ADC identity. Writing that against no
    // project would produce code that compiles, has never run, and would be
    // trusted because it looks finished. It lands with Phase 0, when there is a
    // project to verify it against.
    throw new Error(
      `No ephemeral token minter is configured for production. ` +
        `Voice is unavailable for session ${sessionId}.`,
    );
  }
}

export function createTokenMinter(): TokenMinter {
  // Same shape as the mailer: refuse in production rather than quietly handing
  // the browser something that does not work, or worse, something that does.
  return env.production ? new VertexTokenMinter() : new FakeTokenMinter();
}
