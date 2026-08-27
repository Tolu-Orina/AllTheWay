import { createPrivateKey, createSign } from "node:crypto";

/**
 * The scribe's AgentCard, signed in TypeScript.
 *
 * ## Why this is a second implementation of something that already exists
 *
 * Every other card is signed by `libs/agentcards`, which is Python. The scribe
 * is Node, and the registry verifies with the Python library — so this has to
 * produce bytes that library accepts, exactly.
 *
 * That is a genuine risk and the reason this file is as explicit as it is. The
 * cross-language test alongside it signs here and verifies there, because
 * "it looks right" is not a claim anyone can make about a signature.
 *
 * The same trap already caught this project once, in the scope-token minter:
 * ECDSA libraries emit DER, JWS wants fixed-width `R||S`, and a signature that
 * skips the conversion verifies with the library that made it and with nothing
 * else — the worst kind of working.
 *
 * ## The format, precisely
 *
 *   protected = base64url(JSON of {alg, kid}, keys sorted, no whitespace)
 *   payload   = base64url(JSON of the card WITHOUT `signatures`,
 *                         keys sorted, separators "," and ":")
 *   input     = ASCII of `${protected}.${payload}`
 *   signature = base64url(R||S), each 32 bytes big-endian, no padding
 */

const ALGORITHM = "ES256";
const DEFAULT_KEY_ID = "alltheway";
const PROTOCOL_VERSION = "0.3.0";

export const CARD_VERSION = "1.0.0";

function b64u(raw: Buffer): string {
  return raw.toString("base64url");
}

/**
 * JSON with sorted keys and no insignificant whitespace.
 *
 * `JSON.stringify` does not sort keys, and Python's `sort_keys=True` does — so
 * a card serialised here and canonicalised there would differ by key order
 * alone, and the signature would fail while both sides looked correct.
 *
 * Recursive, because nested objects are sorted too: Python's `sort_keys`
 * applies at every level, and stopping at the top would pass every test whose
 * card happened to have flat objects.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    // Array order is meaningful and must not be touched. Only object keys sort.
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // Undefined members vanish in Python's dict and would otherwise serialise
    // as nothing here while still emitting a comma.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

/** The bytes a signature covers: the card without its own signatures. */
export function canonicalCard(card: Record<string, unknown>): Buffer {
  const { signatures: _dropped, ...body } = card;
  return Buffer.from(canonicalJson(body), "utf8");
}

/**
 * DER to fixed-width `R||S`.
 *
 * Node emits DER; JWS wants two 32-byte integers. The leading-zero handling is
 * the part that bites: DER pads a value whose top bit is set, and one signature
 * in roughly every two hundred and fifty is short enough to need padding the
 * other way. Both are handled, and the test mints enough signatures to hit them.
 */
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
  kid: string = DEFAULT_KEY_ID,
): Record<string, unknown> {
  const protectedB64 = b64u(
    Buffer.from(canonicalJson({ alg: ALGORITHM, kid }), "utf8"),
  );
  const payload = canonicalCard(card);

  const signer = createSign("SHA256");
  signer.update(Buffer.from(`${protectedB64}.${b64u(payload)}`, "ascii"));
  signer.end();

  // A key pasted through a console or stored with CRLF fails to load with an
  // error about the header while showing a perfectly good body. The Python side
  // normalises for the same reason.
  const normalised = privateKeyPem.replace(/\r\n/g, "\n").trim();
  const der = signer.sign(createPrivateKey(normalised));

  return {
    ...card,
    // Replaced, never appended. A card carrying two signatures is a card where
    // "is it signed?" has more than one answer.
    signatures: [{ protected: protectedB64, signature: b64u(derToRaw(der)) }],
  };
}

function baseUrl(): string {
  // Read from the environment, because the same image runs in dev and prod on
  // different hostnames and a card advertising the wrong one sends callers
  // somewhere real that belongs to another environment.
  // PUBLIC_URL, the name Terraform already sets for every service. A second
  // convention would be one more thing to set and one more place to forget.
  return (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
}

/**
 * The card, before signing.
 *
 * ## What it does not claim
 *
 * There is no skill for joining or speaking in a meeting. The scribe listens —
 * over a transcript it is handed, or audio a user captured themselves — and the
 * card says so, because a card is the machine-readable version of the promise
 * FR-C4 makes to a person.
 */
export function buildCard(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    name: "Meeting scribe",
    description:
      "Takes notes from a meeting and turns commitments into proposals. " +
      "It listens; it cannot speak, and it never joins a call.",
    version: CARD_VERSION,
    url: baseUrl(),
    preferredTransport: "JSONRPC",
    provider: {
      organization: "AllTheWay",
      url: "https://alltheway.rinegansolutions.com",
    },
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text/plain", "audio/pcm"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "take_notes",
        name: "Take notes in a meeting",
        description:
          "Turn what was said into notes, whether read from a Meet transcript " +
          "after the call or captured live on the user's own machine.",
        tags: ["meetings", "notes"],
      },
      {
        id: "propose_commitments",
        name: "Surface commitments",
        description:
          "Detect commitments and record them as unconfirmed proposals. " +
          "Nothing is sent, scheduled or assigned on the strength of a transcript.",
        tags: ["meetings", "commitments"],
      },
    ],
  };
}

/** The card as the well-known endpoint serves it, signed when a key is present. */
export function servedCard(): Record<string, unknown> {
  const card = buildCard();
  const pem = (process.env.AGENT_CARD_SIGNING_KEY ?? "").trim();
  if (!pem) {
    // Unsigned is a supported state. The registry reports it as unverified,
    // which is the truth, rather than the service refusing to start.
    return card;
  }
  const kid = (process.env.AGENT_CARD_KEY_ID ?? "").trim() || DEFAULT_KEY_ID;
  return signCard(card, pem, kid);
}
