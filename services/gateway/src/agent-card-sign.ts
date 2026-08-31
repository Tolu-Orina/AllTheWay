import { createPrivateKey, createSign } from "node:crypto";

/**
 * AgentCard signatures in TypeScript.
 *
 * Same bytes as `services/scribe/src/a2a-card.ts`. The registry verifies with
 * Python (`libs/agentcards`); a Node signature that only Node accepts is the
 * unsigned card in a more convincing costume. The scribe test is the
 * cross-language proof of this format — this file must not invent a third.
 */

const ALGORITHM = "ES256";
export const DEFAULT_CARD_KEY_ID = "alltheway";

function b64u(raw: Buffer): string {
  return raw.toString("base64url");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

export function canonicalCard(card: Record<string, unknown>): Buffer {
  const { signatures: _dropped, ...body } = card;
  return Buffer.from(canonicalJson(body), "utf8");
}

function derToRaw(der: Buffer): Buffer {
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;

  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("Malformed DER signature.");
    const length = der[offset + 1]!;
    let value = der.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    while (value.length > 32 && value[0] === 0x00) value = value.subarray(1);
    return Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
  };

  return Buffer.concat([readInt(), readInt()]);
}

export function signCard(
  card: Record<string, unknown>,
  privateKeyPem: string,
  kid: string = DEFAULT_CARD_KEY_ID,
): Record<string, unknown> {
  const protectedB64 = b64u(Buffer.from(canonicalJson({ alg: ALGORITHM, kid }), "utf8"));
  const payload = canonicalCard(card);

  const signer = createSign("SHA256");
  signer.update(Buffer.from(`${protectedB64}.${b64u(payload)}`, "ascii"));
  signer.end();

  const normalised = privateKeyPem.replace(/\r\n/g, "\n").trim();
  const der = signer.sign(createPrivateKey(normalised));

  return {
    ...card,
    signatures: [{ protected: protectedB64, signature: b64u(derToRaw(der)) }],
  };
}

/** Sign when a key is present. Unsigned is a reported state, not a crash. */
export function servedCard(
  card: Record<string, unknown>,
  opts: { signingKey?: string; keyId?: string } = {},
): Record<string, unknown> {
  const pem = (opts.signingKey ?? process.env.AGENT_CARD_SIGNING_KEY ?? "").trim();
  if (!pem) return card;
  const kid =
    (opts.keyId ?? process.env.AGENT_CARD_KEY_ID ?? "").trim() || DEFAULT_CARD_KEY_ID;
  return signCard(card, pem, kid);
}
