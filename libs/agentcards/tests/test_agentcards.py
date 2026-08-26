"""A card that cannot be trusted must not verify.

The properties here are the ones an attacker would go after: swapping the URL a
card advertises, downgrading the algorithm, presenting a key nobody knows, or
simply removing the signature and hoping nothing checks.
"""

from __future__ import annotations

import base64
import json

import pytest

from alltheway_agentcards import (
    Reason,
    canonical,
    generate_key,
    keys_from_pems,
    load_private_key,
    sign,
    verify,
)

KID = "orchestrator-2026-08"


@pytest.fixture
def keypair():
    private_pem, public_pem = generate_key()
    return load_private_key(private_pem), keys_from_pems([(KID, public_pem)])


def card() -> dict:
    return {
        "name": "orchestrator",
        "version": "1.1.0",
        "supported_interfaces": [{"url": "https://orchestrator-prod.run.app"}],
        "skills": [{"id": "plan_session"}, {"id": "clarify"}],
    }


def test_a_signed_card_verifies(keypair):
    private, keys = keypair
    result = verify(sign(card(), private_key=private, kid=KID), public_keys=keys)
    assert result.ok
    assert result.kid == KID


def test_an_unsigned_card_does_not_verify(keypair):
    _, keys = keypair
    assert verify(card(), public_keys=keys).reason is Reason.UNSIGNED


def test_changing_the_advertised_url_breaks_the_signature(keypair):
    # The attack this exists to stop. An A2A client talks to the URL the card
    # advertises, so whoever can rewrite that field redirects the traffic.
    private, keys = keypair
    signed = sign(card(), private_key=private, kid=KID)
    signed["supported_interfaces"] = [{"url": "https://evil.example"}]

    assert verify(signed, public_keys=keys).reason is Reason.INVALID


def test_changing_a_skill_breaks_the_signature(keypair):
    private, keys = keypair
    signed = sign(card(), private_key=private, kid=KID)
    signed["skills"].append({"id": "raw_mcp_passthrough"})

    assert verify(signed, public_keys=keys).reason is Reason.INVALID


def test_a_card_signed_by_an_unknown_key_does_not_verify(keypair):
    _, keys = keypair
    other_private, _ = generate_key()
    signed = sign(card(), private_key=load_private_key(other_private), kid="somebody-else")

    result = verify(signed, public_keys=keys)
    assert result.reason is Reason.UNKNOWN_KEY


def test_a_known_kid_with_the_wrong_key_does_not_verify(keypair):
    # Claiming a kid you do not hold the key for is the interesting version of
    # the previous test: the header looks right and only the maths says no.
    _, keys = keypair
    other_private, _ = generate_key()
    signed = sign(card(), private_key=load_private_key(other_private), kid=KID)

    assert verify(signed, public_keys=keys).reason is Reason.INVALID


def test_the_algorithm_cannot_be_downgraded(keypair):
    private, keys = keypair
    signed = sign(card(), private_key=private, kid=KID)

    header = json.dumps({"alg": "none", "kid": KID}, sort_keys=True, separators=(",", ":"))
    signed["signatures"][0]["protected"] = (
        base64.urlsafe_b64encode(header.encode()).decode().rstrip("=")
    )

    # Rejected on the algorithm, before any verification is attempted.
    assert verify(signed, public_keys=keys).reason is Reason.BAD_ALGORITHM


def test_a_malformed_signature_does_not_verify(keypair):
    private, keys = keypair
    signed = sign(card(), private_key=private, kid=KID)
    signed["signatures"][0]["signature"] = "not base64url!!"

    assert not verify(signed, public_keys=keys).ok


def test_the_signature_does_not_cover_itself(keypair):
    # Signing must exclude the signatures field, or attaching the signature
    # would change the bytes it was computed over.
    private, _ = keypair
    signed = sign(card(), private_key=private, kid=KID)
    assert canonical(signed) == canonical(card())


def test_key_order_does_not_change_what_is_signed():
    # Two encoders that disagree about key order would otherwise produce a
    # genuine card that fails verification, and the symptom would point at the
    # key rather than at the formatting.
    a = {"name": "x", "version": "1", "skills": []}
    b = {"skills": [], "version": "1", "name": "x"}
    assert canonical(a) == canonical(b)


def test_signing_replaces_rather_than_appends(keypair):
    # A card carrying two signatures is a card where "is it signed?" has more
    # than one answer, and every caller has to decide which one counts.
    private, keys = keypair
    once = sign(card(), private_key=private, kid=KID)
    twice = sign(once, private_key=private, kid=KID)

    assert len(twice["signatures"]) == 1
    assert verify(twice, public_keys=keys).ok


def test_verification_with_no_keys_configured_refuses(keypair):
    private, _ = keypair
    signed = sign(card(), private_key=private, kid=KID)

    # An empty key set is not a reason to trust anything.
    assert verify(signed, public_keys={}).reason is Reason.UNKNOWN_KEY
