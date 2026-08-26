"""Signing and verifying AgentCards.

## Why a card needs a signature at all

An A2A client discovers an agent by fetching its card and then talks to the URL
the *card* advertises — not the URL it was handed. That is already load-bearing
in this system: Phase 4 found that a card built without `PUBLIC_URL` sent every
caller to `localhost`, and the fix was to make the card authoritative.

Authoritative and unauthenticated is a bad combination. Anything that can
answer a card fetch can redirect an agent's traffic, rename its skills, or
declare a weaker security scheme. Cloud Run's IAM stops that today between our
own services — but the registry's whole purpose is that agents we did *not*
deploy become discoverable, and at that point "the card came from the right
host" stops being an argument.

So the card carries a detached JWS, and the client checks it before trusting a
single field.

## Detached, and over a canonical form

The signature covers the card *without* its `signatures` field — otherwise
signing would change the thing being signed. The payload is canonical JSON:
sorted keys, no insignificant whitespace. Two encoders that disagree about key
order would otherwise produce a valid card that fails verification, and the
failure would look like a key problem rather than a formatting one.

## ES256, and one key at a time

P-256 because the keys are small enough to sit in Secret Manager as PEM without
anyone being tempted to shorten them. `kid` in the protected header names which
key signed, so a rotation can publish the new key before retiring the old one
and no verifier has to be redeployed in between.

## Verification failure is refusal, never a warning

`verify` returns a reason rather than a bool so a caller can say what was wrong,
but every non-`OK` reason means the same thing: do not use this card. There is
deliberately no "unsigned is fine" mode in this module — a caller that wants to
tolerate unsigned cards has to say so at the call site, in code someone reads.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Iterable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)

ALGORITHM = "ES256"

#: The field a signature lives in, and the one excluded from what it covers.
SIGNATURES_FIELD = "signatures"


class Reason(StrEnum):
    OK = "ok"
    UNSIGNED = "unsigned"
    UNKNOWN_KEY = "unknown_key"
    BAD_ALGORITHM = "bad_algorithm"
    MALFORMED = "malformed"
    INVALID = "invalid"


@dataclass(frozen=True)
class Result:
    reason: Reason
    #: Which key verified it, when one did. Useful in a trace: "signed by
    #: orchestrator-2026-08" says more than "valid".
    kid: str = ""

    @property
    def ok(self) -> bool:
        return self.reason is Reason.OK

    def summary(self) -> str:
        if self.ok:
            return f"Card signature verified ({self.kid})."
        return {
            Reason.UNSIGNED: "This card carries no signature.",
            Reason.UNKNOWN_KEY: "This card was signed by a key we do not know.",
            Reason.BAD_ALGORITHM: "This card was signed with an algorithm we do not accept.",
            Reason.MALFORMED: "This card's signature is not well formed.",
            Reason.INVALID: "This card's signature does not match its contents.",
        }[self.reason]


# --------------------------------------------------------------- encoding


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64u(text: str) -> bytes:
    # JWS strips padding; put it back rather than requiring callers to.
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def canonical(card: dict[str, Any]) -> bytes:
    """The bytes a signature actually covers.

    Sorted keys and no insignificant whitespace, with `signatures` removed.
    Deterministic on purpose: a card re-serialised by a different encoder must
    produce identical bytes, or a genuine card fails verification and the
    symptom points at the key instead of the encoder.
    """
    body = {k: v for k, v in card.items() if k != SIGNATURES_FIELD}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _signing_input(protected_b64: str, payload: bytes) -> bytes:
    return f"{protected_b64}.{_b64u(payload)}".encode("ascii")


# ------------------------------------------------------------------ keys


#: A single newline, as bytes. Written this way because the whole point of
#: the function below is line endings.
NEWLINE = bytes([10])


def _normalise(pem: str | bytes) -> bytes:
    """PEM bytes with line endings the parser accepts.

    A key fetched on Windows, pasted through a console, or stored with CRLF
    arrives with carriage returns and fails to load — reporting an invalid
    header while showing a perfectly good body, which reads as a corrupt key
    rather than a line-ending problem. That cost an hour once; normalising
    here costs nothing.

    splitlines() rather than a replace, because it handles CRLF, CR and LF
    without three special cases.
    """
    raw = pem.encode() if isinstance(pem, str) else pem
    # Blank lines are dropped too. A PEM has none that mean anything, and a
    # key that has been through a console or a text-mode redirect can pick
    # them up — which the parser reports as an invalid header while showing
    # a perfectly good body.
    kept = [line.strip() for line in raw.splitlines() if line.strip()]
    return NEWLINE.join(kept) + NEWLINE


def load_private_key(pem: str | bytes) -> ec.EllipticCurvePrivateKey:
    raw = _normalise(pem)
    key = serialization.load_pem_private_key(raw, password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise ValueError("Card signing requires an EC P-256 private key.")
    return key


def load_public_key(pem: str | bytes) -> ec.EllipticCurvePublicKey:
    raw = _normalise(pem)
    key = serialization.load_pem_public_key(raw)
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise ValueError("Card verification requires an EC P-256 public key.")
    return key


def generate_key() -> tuple[str, str]:
    """A fresh (private PEM, public PEM). Used by tooling and tests, not at runtime."""
    private = ec.generate_private_key(ec.SECP256R1())
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


# ------------------------------------------------------------------ sign


def sign(card: dict[str, Any], *, private_key: ec.EllipticCurvePrivateKey, kid: str) -> dict[str, Any]:
    """Return the card with its signature attached.

    Replaces any existing signatures rather than appending. Multiple signatures
    are legal in JWS, but a card carrying two is a card where "is it signed?"
    has more than one answer, and every caller would have to decide which one
    counts.
    """
    protected = {"alg": ALGORITHM, "kid": kid}
    protected_b64 = _b64u(
        json.dumps(protected, sort_keys=True, separators=(",", ":")).encode()
    )

    payload = canonical(card)
    der = private_key.sign(_signing_input(protected_b64, payload), ec.ECDSA(hashes.SHA256()))

    # JWS wants R||S fixed-width, not the DER the library produces. Getting this
    # wrong yields a signature that verifies with this library and with nothing
    # else, which is the worst kind of working.
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    signed = dict(card)
    signed[SIGNATURES_FIELD] = [
        {"protected": protected_b64, "signature": _b64u(raw)}
    ]
    return signed


# ---------------------------------------------------------------- verify


def verify(
    card: dict[str, Any],
    *,
    public_keys: dict[str, ec.EllipticCurvePublicKey] | None = None,
) -> Result:
    """Check the card's signature against a set of known keys, by `kid`."""
    keys = public_keys or {}
    signatures = card.get(SIGNATURES_FIELD)
    if not isinstance(signatures, list) or not signatures:
        return Result(Reason.UNSIGNED)

    entry = signatures[0]
    if not isinstance(entry, dict):
        return Result(Reason.MALFORMED)

    protected_b64 = entry.get("protected")
    signature_b64 = entry.get("signature")
    if not isinstance(protected_b64, str) or not isinstance(signature_b64, str):
        return Result(Reason.MALFORMED)

    try:
        header = json.loads(_unb64u(protected_b64))
        raw = _unb64u(signature_b64)
    except Exception:
        return Result(Reason.MALFORMED)

    if not isinstance(header, dict):
        return Result(Reason.MALFORMED)

    # Checked before anything is verified: an attacker who can choose the
    # algorithm can choose a weaker one, or `none`.
    if header.get("alg") != ALGORITHM:
        return Result(Reason.BAD_ALGORITHM)

    kid = header.get("kid")
    if not isinstance(kid, str) or kid not in keys:
        return Result(Reason.UNKNOWN_KEY, kid if isinstance(kid, str) else "")

    if len(raw) != 64:
        return Result(Reason.MALFORMED, kid)

    der = encode_dss_signature(
        int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    )

    try:
        keys[kid].verify(
            der,
            _signing_input(protected_b64, canonical(card)),
            ec.ECDSA(hashes.SHA256()),
        )
    except InvalidSignature:
        return Result(Reason.INVALID, kid)

    return Result(Reason.OK, kid)


def keys_from_pems(pems: Iterable[tuple[str, str]]) -> dict[str, ec.EllipticCurvePublicKey]:
    """{kid: key} from (kid, PEM) pairs, as a verifier is usually configured."""
    return {kid: load_public_key(pem) for kid, pem in pems}
