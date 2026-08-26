"""A scope token must not be forgeable, replayable, or ambiguous.

This is layer 4 of the cross-user retrieval defence, so the tests are written
as attacks rather than as happy paths: the question is not "does it work" but
"what does an attacker get for trying".
"""

from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from alltheway_scopetoken import Reason, mint, verify

AUD = "librarian"


def keypair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


@pytest.fixture
def keys():
    return keypair()


def test_a_valid_token_names_its_user(keys):
    private, public = keys
    scope = verify(mint("alice", private_key_pem=private, audience=AUD), public_key_pem=public, audience=AUD)
    assert scope.ok
    assert scope.user == "alice"


def test_no_token_is_not_anonymous_access(keys):
    _, public = keys
    assert verify(None, public_key_pem=public, audience=AUD).reason is Reason.MISSING
    assert verify("", public_key_pem=public, audience=AUD).reason is Reason.MISSING


def test_a_token_signed_by_another_key_is_refused(keys):
    _, public = keys
    other_private, _ = keypair()
    forged = mint("alice", private_key_pem=other_private, audience=AUD)
    assert verify(forged, public_key_pem=public, audience=AUD).reason is Reason.INVALID


def test_changing_the_user_breaks_the_signature(keys):
    """The attack this exists to stop: swap the subject, read someone else."""
    private, public = keys
    token = mint("alice", private_key_pem=private, audience=AUD)
    header, payload, signature = token.split(".")

    body = json.loads(base64.urlsafe_b64decode(payload + "=="))
    body["sub"] = "bob"
    tampered = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode()).decode().rstrip("=")

    assert verify(f"{header}.{tampered}.{signature}", public_key_pem=public, audience=AUD).reason is Reason.INVALID


def test_the_algorithm_cannot_be_downgraded(keys):
    private, public = keys
    token = mint("alice", private_key_pem=private, audience=AUD)
    _, payload, signature = token.split(".")

    none_header = base64.urlsafe_b64encode(
        json.dumps({"alg": "none", "typ": "JWT"}, separators=(",", ":")).encode()
    ).decode().rstrip("=")

    # Rejected on the algorithm, before verification is attempted.
    assert verify(f"{none_header}.{payload}.{signature}", public_key_pem=public, audience=AUD).reason is Reason.BAD_ALGORITHM


def test_a_token_for_another_service_is_refused(keys):
    private, public = keys
    token = mint("alice", private_key_pem=private, audience="some-other-service")
    assert verify(token, public_key_pem=public, audience=AUD).reason is Reason.BAD_AUDIENCE


def test_an_expired_token_is_refused(keys):
    private, public = keys
    token = mint("alice", private_key_pem=private, audience=AUD, lifetime=60, now=1_000_000)
    # Well past expiry plus leeway.
    assert verify(token, public_key_pem=public, audience=AUD, now=1_000_200).reason is Reason.EXPIRED


def test_a_token_just_inside_its_life_is_accepted(keys):
    private, public = keys
    token = mint("alice", private_key_pem=private, audience=AUD, lifetime=120, now=1_000_000)
    assert verify(token, public_key_pem=public, audience=AUD, now=1_000_100).ok


def test_a_token_naming_nobody_is_malformed_not_anonymous(keys):
    """A verified token with no subject must not read as 'no particular user'."""
    private, public = keys
    key = serialization.load_pem_private_key(private.encode(), password=None)

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "ES256", "typ": "JWT"}, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "", "aud": AUD, "exp": 9_999_999_999}, separators=(",", ":")).encode()
    ).decode().rstrip("=")

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    der = key.sign(f"{header}.{payload}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    signature = base64.urlsafe_b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode().rstrip("=")

    assert verify(f"{header}.{payload}.{signature}", public_key_pem=public, audience=AUD).reason is Reason.MALFORMED


def test_garbage_is_refused(keys):
    _, public = keys
    for junk in ["not-a-token", "a.b", "a.b.c.d", "...", "a.b.c"]:
        assert not verify(junk, public_key_pem=public, audience=AUD).ok


def test_no_configured_key_verifies_nothing(keys):
    private, _ = keys
    token = mint("alice", private_key_pem=private, audience=AUD)
    # An empty key set is not a reason to trust anything.
    assert verify(token, public_key_pem="", audience=AUD).reason is Reason.INVALID
