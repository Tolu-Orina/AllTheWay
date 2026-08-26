"""Short-lived, signed proof of which user a request is for.

This is layer 4 of the seven defending against cross-user retrieval, and it is
the one that decides *how much code can cause a breach*.

## Why the librarian has no `uid` parameter

The obvious design is `retrieve(uid, query)`, with the caller passing the user
it is acting for. That design makes every caller part of the isolation
boundary: the gateway, the orchestrator, and anything either of them calls. A
bug anywhere in that chain — a stale variable, a loop reusing an index, a
copy-paste — becomes a cross-tenant read.

So the librarian does not accept a user. It accepts a **token**, signed by the
one service that verified a Firebase ID token in the first place, and reads the
user out of it. The set of code that can cause a breach shrinks from four
services to one.

## Deliberately its own keypair

Not the AgentCard key. The gateway is excluded from card signing on purpose —
"a registry that could sign could manufacture a trusted entry for an agent
nobody deployed", and the same logic says a service that mints scope tokens
should not also be able to mint cards. Two capabilities, two keys.

## Short-lived, and audience-bound

Two minutes. A scope token is minted immediately before the call it authorises,
so a long life buys nothing and costs replay window. The audience binds it to
one service, so a token minted for the librarian cannot be presented anywhere
else that later learns to verify these.

## Verification failure is refusal

There is no "unsigned is acceptable" mode, and no default user. A caller that
cannot present a valid token gets nothing — which is the only safe reading of
"we do not know who this is for".
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from enum import StrEnum

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

ALGORITHM = "ES256"

#: Minted immediately before use. Anything longer is replay window for no gain.
LIFETIME_SECONDS = 120

#: Tolerance for clock skew between two Cloud Run services. Small, because they
#: are both on Google's clock; non-zero, because "both" is not "the same".
LEEWAY_SECONDS = 10


class Reason(StrEnum):
    OK = "ok"
    MISSING = "missing"
    MALFORMED = "malformed"
    BAD_ALGORITHM = "bad_algorithm"
    BAD_AUDIENCE = "bad_audience"
    EXPIRED = "expired"
    INVALID = "invalid"


@dataclass(frozen=True)
class Scope:
    """Who a request is for. `user` is empty unless `ok` is true."""

    reason: Reason
    user: str = ""

    @property
    def ok(self) -> bool:
        return self.reason is Reason.OK

    def summary(self) -> str:
        return {
            Reason.OK: f"Scoped to {self.user}.",
            Reason.MISSING: "No scope token was presented.",
            Reason.MALFORMED: "The scope token is not well formed.",
            Reason.BAD_ALGORITHM: "The scope token uses an algorithm we do not accept.",
            Reason.BAD_AUDIENCE: "The scope token was not minted for this service.",
            Reason.EXPIRED: "The scope token has expired.",
            Reason.INVALID: "The scope token's signature does not match.",
        }[self.reason]


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _normalise(pem: str | bytes) -> bytes:
    raw = pem.encode() if isinstance(pem, str) else pem
    kept = [line.strip() for line in raw.splitlines() if line.strip()]
    return b"\n".join(kept) + b"\n"


def load_public_key(pem: str | bytes) -> ec.EllipticCurvePublicKey:
    key = serialization.load_pem_public_key(_normalise(pem))
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise ValueError("A scope token key must be EC P-256.")
    return key


def verify(
    token: str | None,
    *,
    public_key_pem: str,
    audience: str,
    now: float | None = None,
) -> Scope:
    """Read the user out of a token, or refuse.

    Returns a `Scope` rather than raising, so a caller can report *why* — but
    every non-OK reason means the same thing: this request has no user, and
    must not be served.
    """
    if not token:
        return Scope(Reason.MISSING)
    if not public_key_pem.strip():
        # No key configured means nothing can be verified, which means nothing
        # is trusted. Never a pass-through.
        return Scope(Reason.INVALID)

    parts = token.split(".")
    if len(parts) != 3:
        return Scope(Reason.MALFORMED)

    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(_unb64u(header_b64))
        payload = json.loads(_unb64u(payload_b64))
        raw_signature = _unb64u(signature_b64)
    except Exception:
        return Scope(Reason.MALFORMED)

    if not isinstance(header, dict) or not isinstance(payload, dict):
        return Scope(Reason.MALFORMED)

    # Checked before any verification: an attacker who chooses the algorithm
    # chooses a weaker one, or `none`.
    if header.get("alg") != ALGORITHM:
        return Scope(Reason.BAD_ALGORITHM)

    if payload.get("aud") != audience:
        return Scope(Reason.BAD_AUDIENCE)

    clock = time.time() if now is None else now
    expiry = payload.get("exp")
    if not isinstance(expiry, (int, float)) or clock > expiry + LEEWAY_SECONDS:
        return Scope(Reason.EXPIRED)

    if len(raw_signature) != 64:
        return Scope(Reason.MALFORMED)

    try:
        # JWS carries R||S fixed-width; the library verifies DER.
        der = encode_dss_signature(
            int.from_bytes(raw_signature[:32], "big"),
            int.from_bytes(raw_signature[32:], "big"),
        )
        load_public_key(public_key_pem).verify(
            der,
            f"{header_b64}.{payload_b64}".encode("ascii"),
            ec.ECDSA(hashes.SHA256()),
        )
    except (InvalidSignature, ValueError):
        return Scope(Reason.INVALID)

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        # A token that verifies but names nobody is not a token for nobody; it
        # is a malformed token, and treating it as anonymous would be the one
        # mistake this whole module exists to prevent.
        return Scope(Reason.MALFORMED)

    return Scope(Reason.OK, subject)


# --------------------------------------------------------------- for tests


def mint(
    user: str,
    *,
    private_key_pem: str,
    audience: str,
    lifetime: int = LIFETIME_SECONDS,
    now: float | None = None,
) -> str:
    """Mint a token. Used by tests and tooling.

    The deployed minter is the gateway, in TypeScript. This exists so the
    verifier can be tested against tokens it did not produce itself, and so a
    cross-language mismatch shows up as a failing test rather than as a
    production 401.
    """
    key = serialization.load_pem_private_key(_normalise(private_key_pem), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise ValueError("A scope token key must be EC P-256.")

    clock = time.time() if now is None else now
    header = _b64u(json.dumps({"alg": ALGORITHM, "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64u(
        json.dumps(
            {"sub": user, "aud": audience, "exp": int(clock + lifetime), "iat": int(clock)},
            separators=(",", ":"),
        ).encode()
    )

    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    der = key.sign(f"{header}.{payload}".encode("ascii"), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{header}.{payload}.{_b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
