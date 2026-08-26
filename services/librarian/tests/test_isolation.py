"""The seven layers, tested with the layers above them disabled.

Testing all seven together proves only that at least one works — which is
precisely what you do not want to discover during an incident. So each test
below removes the protections above the one it is checking.

These run against the Firestore emulator and are skipped, loudly, when it is
absent. A silently-skipped isolation test is worse than no test.
"""

from __future__ import annotations

import os
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from alltheway_scopetoken import Reason, mint, verify

ALICE = f"alice-{int(time.time())}"
BOB = f"bob-{int(time.time())}"


def _keypair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    return (
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode(),
    )


def _emulator() -> bool:
    return bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))


emulated = pytest.mark.skipif(not _emulator(), reason="FIRESTORE_EMULATOR_HOST not set")


def _vector(seed: float) -> list[float]:
    """A deterministic vector of the configured width."""
    from app.embed import DIMENSIONS

    return [seed] * DIMENSIONS


# ------------------------------------------------------------ layer 1: path


@emulated
def test_layer_1_alone_holds_with_the_redundant_filter_removed():
    """The most important test here.

    Layer 3 (the `ownerUid ==` filter) is deliberately *not* applied. If the
    scoped path is doing its job, Bob still cannot see Alice's chunk.
    """
    from app import store

    store.write_chunks(ALICE, "doc-a", "Alice's contract", [(1, 0, "indemnity clause")], [_vector(0.1)])

    # Bob's collection, queried with no owner filter at all.
    everything = list(store.chunks(BOB).limit(50).stream())
    texts = [(d.to_dict() or {}).get("text") for d in everything]

    assert "indemnity clause" not in texts


@emulated
def test_a_users_own_chunks_are_reachable():
    """The control. An isolation test that passes because nothing works at all
    proves nothing."""
    from app import store

    store.write_chunks(ALICE, "doc-b", "Alice's notes", [(1, 0, "quarterly review")], [_vector(0.2)])
    texts = [(d.to_dict() or {}).get("text") for d in store.chunks(ALICE).limit(50).stream()]
    assert "quarterly review" in texts


@emulated
def test_an_empty_user_is_refused_rather_than_unscoped():
    """A caller that reached the store with no user is a bug, and the safe
    response to that bug is not everyone's data."""
    from app import store

    with pytest.raises(ValueError):
        store.chunks("")


# ------------------------------------------------- layer 5: the assertion


def test_layer_5_alone_rejects_a_mismatched_owner():
    """Layer 5, with every layer above it removed.

    Called directly rather than through `retrieve`, because in the assembled
    pipeline layer 3's filter excludes a mismatched owner before this can see
    it. An earlier version of this test went through `retrieve` and passed for
    the wrong reason — layer 3 caught it, and layer 5 was never exercised.
    """
    from app.store import CrossTenantLeak, assert_owner

    with pytest.raises(CrossTenantLeak):
        assert_owner({"ownerUid": ALICE}, BOB, "chunk-1")

    # And a chunk with no owner at all is not treated as public.
    with pytest.raises(CrossTenantLeak):
        assert_owner({}, BOB, "chunk-2")

    # The control: a matching owner passes.
    assert_owner({"ownerUid": BOB}, BOB, "chunk-3")


@emulated
def test_layer_3_catches_a_forged_chunk_before_layer_5_needs_to():
    """The integration view of the same attack.

    A chunk written into Bob's path but claiming Alice as owner is excluded by
    the redundant filter. This asserts the *order* the layers fire in, which is
    what makes layer 5 a backstop rather than the control.
    """
    from google.cloud.firestore_v1.vector import Vector

    from app import store

    store.chunks(BOB).document("forged").set(
        {
            "ownerUid": ALICE,
            "documentId": "doc-x",
            "title": "forged",
            "page": 1,
            "ordinal": 0,
            "text": "should never be returned",
            "embedding": Vector(_vector(0.15)),
            "createdAt": store.now_iso(),
        }
    )

    try:
        passages = store.retrieve(BOB, _vector(0.15), limit=5)
        assert all(p.text != "should never be returned" for p in passages)
    finally:
        store.chunks(BOB).document("forged").delete()


# ------------------------------------------------- layer 4: the scope token


def test_layer_4_the_service_has_no_uid_parameter():
    """A signature check, because this is a property of the API surface rather
    than of any single call.

    If a future edit adds `uid` to a route, every caller rejoins the isolation
    boundary — and that change would look entirely reasonable in review without
    this test to argue with it.
    """
    import inspect

    from app import main

    for name in ("post_document", "get_documents", "delete_document", "post_retrieve"):
        parameters = set(inspect.signature(getattr(main, name)).parameters)
        assert not parameters & {"uid", "user", "userId", "owner", "ownerUid"}, name


def test_layer_4_a_forged_token_names_nobody():
    private, public = _keypair()
    other_private, _ = _keypair()

    forged = mint(ALICE, private_key_pem=other_private, audience="librarian")
    assert verify(forged, public_key_pem=public, audience="librarian").reason is Reason.INVALID

    genuine = mint(ALICE, private_key_pem=private, audience="librarian")
    assert verify(genuine, public_key_pem=public, audience="librarian").user == ALICE


def test_layer_4_no_token_is_not_anonymous_access():
    _, public = _keypair()
    assert not verify(None, public_key_pem=public, audience="librarian").ok


# ------------------------------------------------------------- deletion


@emulated
def test_deleting_a_document_removes_its_retrievability():
    """FR-D3. A document you deleted that still answers questions is not
    deleted."""
    from app import store

    store.write_chunks(
        ALICE, "doc-del", "To be deleted", [(1, 0, "secret figure is 42")], [_vector(0.3)]
    )
    removed = store.delete_document(ALICE, "doc-del")
    assert removed >= 1

    texts = [(d.to_dict() or {}).get("text") for d in store.chunks(ALICE).limit(100).stream()]
    assert "secret figure is 42" not in texts
