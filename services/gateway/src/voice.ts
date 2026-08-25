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
 * The fake mints something structurally identical and obviously useless, so the
 * whole flow — auth, TTL, refusal, the browser code that consumes it — runs and
 * is tested with no GCP project.
 *
 * The production implementation turned out not to be a swap of this class:
 * Vertex does not issue ephemeral Live API tokens at all (see below). The
 * interface still earns its place — it is what keeps the refusal explicit and
 * the development path honest — but the real voice path will mediate the
 * session server-side rather than hand the browser a credential.
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
    // Not unimplemented — not available.
    //
    // Tested against the real project on 2026-08-25: the GenAI SDK's
    // `auth_tokens.create()` refuses with "This method is only supported in the
    // Gemini Developer client." Ephemeral Live API tokens exist for the Gemini
    // Developer API, which authenticates with an AI Studio key — explicitly
    // ruled out for this product.
    //
    // So the browser cannot hold a short-lived Vertex credential, and the
    // plan's "mint a token per session" shape does not apply here. The route
    // that does is the one the architecture doc already prescribes (§3.8): a
    // server-side mediator holding the Live API session, with the browser
    // talking to us rather than to Google. The browser then needs no model
    // credential at all, which is a stronger position than a short-lived one.
    //
    // Left throwing on purpose. A plausible-looking mint call that has never
    // succeeded would be trusted precisely because it looks finished.
    throw new Error(
      `Ephemeral Live API tokens are not available on Vertex; voice needs a ` +
        `server-side session mediator. Voice is unavailable for session ${sessionId}.`,
    );
  }
}

export function createTokenMinter(): TokenMinter {
  // Same shape as the mailer: refuse in production rather than quietly handing
  // the browser something that does not work, or worse, something that does.
  return env.production ? new VertexTokenMinter() : new FakeTokenMinter();
}
