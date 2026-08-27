"""The sixth document on Free is refused before ingest runs."""

from __future__ import annotations

import os
import time

import pytest

ALICE = f"alice-docs-{int(time.time())}"


def _emulator() -> bool:
    return bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))


emulated = pytest.mark.skipif(not _emulator(), reason="FIRESTORE_EMULATOR_HOST not set")


@emulated
def test_a_sixth_document_on_free_is_refused():
    from app import quota, store

    for i in range(5):
        store.create_document(ALICE, title=f"doc-{i}", mime_type="text/plain", pages=1)

    allowed, message = quota.document_slot(ALICE)
    assert not allowed
    assert "5 documents" in message


@emulated
def test_a_fifth_document_on_free_is_allowed():
    from app import quota, store

    user = f"{ALICE}-under"
    for i in range(4):
        store.create_document(user, title=f"doc-{i}", mime_type="text/plain", pages=1)

    allowed, message = quota.document_slot(user)
    assert allowed
    assert message == ""
