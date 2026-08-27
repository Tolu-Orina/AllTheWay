import { ok, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildCard, canonicalJson, signCard } from "./a2a-card.js";

/**
 * This file signs a card in TypeScript and verifies it with the Python library
 * the registry actually uses.
 *
 * That round trip is the whole point. Every other card in the system is signed
 * by `libs/agentcards`; this is a second implementation of the same format in a
 * different language, and a second implementation is only correct if the first
 * one says so. "It looks right" is not a claim anyone can make about a
 * signature.
 *
 * The project has been caught by exactly this before, in the scope-token
 * minter: ECDSA emits DER, JWS wants fixed-width `R||S`, and skipping the
 * conversion produces a signature that verifies with the library that made it
 * and with nothing else.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

function pythonAvailable(): boolean {
  try {
    execFileSync("python", ["-c", "import cryptography"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const havePython = pythonAvailable();
if (!havePython) {
  console.warn("\n  [a2a-card] python + cryptography not available — skipping cross-language checks.\n");
}
const crossLanguage = { skip: !havePython };

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Verify with the same library the registry uses, in a subprocess. */
function verifyWithPython(
  card: unknown,
  publicPem: string,
  // The library looks its key up BY kid, defaulting to "alltheway". Omitting
  // this reports `unknown_key` — which looks exactly like a broken signature
  // and is not one. That cost a confusing five minutes here already.
  kid = "test-key",
): { reason: string; kid: string } {
  const dir = mkdtempSync(join(tmpdir(), "atw-card-"));
  const cardPath = join(dir, "card.json");
  const keyPath = join(dir, "key.pem");
  writeFileSync(cardPath, JSON.stringify(card), "utf8");
  writeFileSync(keyPath, publicPem, "utf8");

  const script = `
import io, json, sys
sys.path.insert(0, r"${join(REPO, "libs", "agentcards", "src").replace(/\\/g, "\\\\")}")
from alltheway_agentcards.a2a import verify_card
card = json.load(io.open(r"${cardPath.replace(/\\/g, "\\\\")}", encoding="utf-8"))
pem = io.open(r"${keyPath.replace(/\\/g, "\\\\")}", encoding="utf-8").read()
result = verify_card(card, public_key_pem=pem, kid="${kid}")
print(json.dumps({"reason": str(result.reason.value), "kid": result.kid or ""}))
`;
  const out = execFileSync("python", ["-c", script], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

test("canonical JSON sorts keys at every level", () => {
  /**
   * Python's `sort_keys=True` sorts nested objects too. Stopping at the top
   * would pass any test whose card happened to be flat, and fail in production
   * on the first card with a `provider` block — which every card has.
   */
  strictEqual(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  strictEqual(canonicalJson({ z: { d: 1, c: 2 } }), '{"z":{"c":2,"d":1}}');
});

test("canonical JSON leaves array order alone", () => {
  // Skills are ordered. Sorting them would change the document while claiming
  // to canonicalise it.
  strictEqual(canonicalJson([3, 1, 2]), "[3,1,2]");
});

test("canonical JSON has no insignificant whitespace", () => {
  const text = canonicalJson({ a: 1, b: [1, 2], c: { d: "x" } });
  ok(!/\s/.test(text), text);
});

test("a card signed here verifies there", crossLanguage, () => {
  const { privatePem, publicPem } = keyPair();
  const signed = signCard(buildCard(), privatePem, "test-key");

  const result = verifyWithPython(signed, publicPem);
  strictEqual(result.reason, "ok", `python said: ${result.reason}`);
  strictEqual(result.kid, "test-key");
});

test("many signatures survive DER padding", crossLanguage, () => {
  /**
   * The bug this exists for.
   *
   * DER pads an integer whose top bit is set, and roughly one signature in two
   * hundred and fifty has an R or S short enough to need padding the other way.
   * A conversion that mishandles either works almost always — which is exactly
   * how it reaches production.
   */
  const { privatePem, publicPem } = keyPair();

  for (let i = 0; i < 12; i += 1) {
    const card = { ...buildCard(), version: `1.0.${i}` };
    const signed = signCard(card, privatePem, "test-key");
    const result = verifyWithPython(signed, publicPem);
    strictEqual(result.reason, "ok", `signature ${i} failed: ${result.reason}`);
  }
});

test("a tampered card does not verify", crossLanguage, () => {
  // The signature has to actually cover the contents. A card whose description
  // can be edited after signing is a card that attests nothing.
  const { privatePem, publicPem } = keyPair();
  const signed = signCard(buildCard(), privatePem, "test-key") as Record<string, unknown>;
  signed.description = "Something nobody signed.";

  const result = verifyWithPython(signed, publicPem);
  ok(result.reason !== "ok", "a tampered card verified");
});

test("a card signed by another key does not verify", crossLanguage, () => {
  const mine = keyPair();
  const theirs = keyPair();
  const signed = signCard(buildCard(), mine.privatePem, "test-key");

  const result = verifyWithPython(signed, theirs.publicPem);
  ok(result.reason !== "ok", "a foreign signature verified");
});

test("the card never claims it can speak", () => {
  /**
   * FR-C4, in the machine-readable form. A card is the promise other agents
   * read, and a skill implying the scribe can talk in a meeting would contradict
   * the configuration that makes it impossible.
   */
  const card = buildCard();
  const text = JSON.stringify(card).toLowerCase();

  ok(text.includes("cannot speak"));
  for (const claim of ["\"join", "speak in", "reply in the meeting", "respond to participants"]) {
    ok(!text.includes(claim), `the card claims: ${claim}`);
  }
});

test("an unsigned card is served rather than nothing", () => {
  // A missing key is a deployment state, not a fault. The registry reports
  // unverified, which is the truth.
  const card = buildCard();
  strictEqual("signatures" in card, false);
  ok(String(card.name).length > 0);
});
