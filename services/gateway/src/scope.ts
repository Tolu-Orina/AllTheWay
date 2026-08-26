import { createPrivateKey, createSign } from "node:crypto";

import { env } from "./env.js";

/**
 * Minting the scope token that tells the librarian who a request is for.
 *
 * This is the *only* place a user identity crosses into the document services,
 * and that is the point. The librarian has no `uid` parameter — it reads the
 * subject out of a token signed here, by the one service that verified a
 * Firebase ID token in the first place.
 *
 * The alternative design, `retrieve(uid, query)`, would put the gateway, the
 * orchestrator and everything they call inside the isolation boundary. Any
 * stale variable in any of them becomes a cross-tenant read. This shrinks that
 * set to one file.
 *
 * ## ES256, by hand, because the encoding is the trap
 *
 * Node's signer emits ASN.1 DER. JWS wants fixed-width `R||S`. Handing DER
 * straight to a JWS verifier produces a signature that verifies with nothing —
 * and the same trap already caught the AgentCard signing work, so it is
 * handled explicitly here rather than assumed.
 *
 * ## Two minutes
 *
 * Minted immediately before the call it authorises. A longer life buys
 * nothing and costs replay window.
 */

const ALGORITHM = "ES256";
const LIFETIME_SECONDS = 120;

const b64u = (raw: Buffer | string): string =>
  Buffer.from(raw).toString("base64url");

/**
 * ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` → fixed-width `R||S`.
 *
 * DER trims leading zero bytes and adds one back when the high bit would make
 * the integer look negative. Both must be undone, and both are why a naive
 * slice produces a signature that is *usually* right — which is worse than one
 * that is always wrong.
 */
function derToRaw(der: Buffer): Buffer {
  let offset = 2;
  // Long-form length: skip the length-of-length bytes.
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;

  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("Malformed DER signature.");
    const length = der[offset + 1]!;
    let value = der.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    // Strip the padding byte DER adds when the high bit is set.
    while (value.length > 32 && value[0] === 0x00) value = value.subarray(1);
    // Left-pad to the curve width.
    return Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
  };

  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

export const scopeTokenConfigured = (): boolean =>
  env.scopeTokenSigningKey.trim().length > 0;

/**
 * A token naming `uid`, for one audience, valid for two minutes.
 *
 * Throws rather than returning empty when no key is configured. A caller that
 * proceeded with an empty token would be a caller making an unscoped request,
 * which is the failure this exists to prevent.
 */
export function mintScopeToken(uid: string, audience: string): string {
  if (!uid) throw new Error("A scope token must name a user.");
  if (!scopeTokenConfigured()) {
    throw new Error(
      "SCOPE_TOKEN_SIGNING_KEY is not set, so no request can be scoped to a user.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: ALGORITHM, typ: "JWT" }));
  const payload = b64u(
    JSON.stringify({ sub: uid, aud: audience, exp: now + LIFETIME_SECONDS, iat: now }),
  );

  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();

  const der = signer.sign(createPrivateKey(env.scopeTokenSigningKey));
  return `${header}.${payload}.${b64u(derToRaw(der))}`;
}

/** Header for an outbound call to a document service. */
export function scopeHeader(uid: string, audience: string): Record<string, string> {
  return { "X-Scope-Token": mintScopeToken(uid, audience) };
}
