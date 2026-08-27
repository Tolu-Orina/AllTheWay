"""Documents and their chunks, scoped to exactly one user.

This module is layers 1, 2, 3 and 5 of the cross-user retrieval defence. Every
public function takes `user` as its first argument, and every one of them uses
it to *build a path* rather than to filter results.

## The path is the boundary

`users/{uid}/documentChunks` — a query rooted there cannot see another user's
chunks. Not "does not", *cannot*: there is no filter to forget, because the
collection reference itself is already scoped. This follows `preferences(uid)`
and `sessions(uid)`, which have worked this way since Phase 0.

## No collection-group query, ever

`collection_group` is the one Firestore construct that spans users, and it
would make the scoped path meaningless. There is not one in this codebase, and
`scripts/check-tenant-isolation.py` fails the build if one appears.

## The redundant filter, and the assertion after

`ownerUid` is written to every chunk and filtered on anyway (layer 3), and
every retrieved chunk's owner is checked before it is returned (layer 5). Both
are redundant if layer 1 holds. They exist because the thing being defended
against is a developer, in a hurry, eighteen months from now — and redundant
controls are how you survive that.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

from google.cloud import firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "alltheway-local")

db = firestore.Client(project=PROJECT)


def _user_doc(user: str):
    if not user:
        # A caller that reached here with no user is a bug, and the safe
        # response to that bug is not "everyone's data".
        raise ValueError("A user is required. There is no unscoped access.")
    return db.collection("users").document(user)


def documents(user: str):
    return _user_doc(user).collection("documents")


def chunks(user: str):
    return _user_doc(user).collection("documentChunks")


def concepts(user: str):
    """The struggle model — what this user finds hard. See the plan, Phase B."""
    return _user_doc(user).collection("concepts")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def count_documents(user: str) -> int:
    """How many documents this user currently stores. Delete frees a slot."""
    return sum(1 for _ in documents(user).stream())


@dataclass(frozen=True)
class Passage:
    """One retrieved chunk, with everything a citation needs."""

    chunk_id: str
    document_id: str
    title: str
    page: int
    text: str
    distance: float


# ------------------------------------------------------------------ writing


def create_document(user: str, *, title: str, mime_type: str, pages: int) -> str:
    ref = documents(user).document()
    ref.set(
        {
            # Redundant with the path (layer 3), on purpose.
            "ownerUid": user,
            "title": title,
            "mimeType": mime_type,
            "pages": pages,
            "status": "screening",
            "createdAt": now_iso(),
        }
    )
    return ref.id


def set_status(user: str, document_id: str, status: str, **extra) -> None:
    documents(user).document(document_id).set({"status": status, **extra}, merge=True)


def write_chunks(
    user: str,
    document_id: str,
    title: str,
    pieces: list[tuple[int, int, str]],
    embeddings: list[list[float]],
) -> int:
    """Write chunks and their embeddings. Returns how many landed.

    Batched, because a 40-page document is hundreds of writes and one at a
    time would take minutes. Batch size is Firestore's limit, not a guess.
    """
    if len(pieces) != len(embeddings):
        raise ValueError("Every chunk must have exactly one embedding.")

    written = 0
    batch = db.batch()
    for index, ((page, ordinal, text), vector) in enumerate(zip(pieces, embeddings)):
        ref = chunks(user).document()
        batch.set(
            ref,
            {
                "ownerUid": user,
                "documentId": document_id,
                "title": title,
                "page": page,
                "ordinal": ordinal,
                "text": text,
                "embedding": Vector(vector),
                "createdAt": now_iso(),
            },
        )
        written += 1
        # 500 is Firestore's per-batch write limit.
        if (index + 1) % 400 == 0:
            batch.commit()
            batch = db.batch()

    batch.commit()
    return written


# ------------------------------------------------------------------ reading


def retrieve(user: str, query_vector: list[float], *, limit: int = 6) -> list[Passage]:
    """The nearest chunks to a query, for exactly this user.

    Three of the seven layers are visible in these few lines, and the ordering
    matters: the collection is already scoped before any filter is applied, so
    the filter is redundancy rather than the control.
    """
    query = (
        chunks(user)  # layer 1: the path is the scope
        .where(filter=firestore.FieldFilter("ownerUid", "==", user))  # layer 3
        .find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=limit,
            distance_result_field="_distance",
        )
    )

    passages: list[Passage] = []
    for doc in query.get():
        data = doc.to_dict() or {}

        assert_owner(data, user, doc.id)

        passages.append(
            Passage(
                chunk_id=doc.id,
                document_id=data.get("documentId", ""),
                title=data.get("title", ""),
                page=int(data.get("page", 0)),
                text=data.get("text", ""),
                distance=float(data.get("_distance", 0.0)),
            )
        )

    return passages


def assert_owner(data: dict, user: str, chunk_id: str) -> None:
    """Layer 5: the last thing between a chunk and a prompt.

    Extracted so it can be tested *alone*. In the assembled pipeline layer 3's
    filter catches a mismatched owner before this ever sees it — which is the
    layers working, and also why an end-to-end test cannot exercise this one.
    Testing seven controls together proves at most that one of them works.

    Raises rather than skipping the row. If this fires, four layers have
    already failed, and a silently dropped result would hide exactly the
    incident someone needs to know about.
    """
    if data.get("ownerUid") != user:
        raise CrossTenantLeak(
            f"chunk {chunk_id} belongs to another user and was returned for {user}"
        )


class CrossTenantLeak(RuntimeError):
    """A chunk was returned for the wrong user.

    Raised rather than filtered. If this ever fires, four layers have already
    failed and the correct behaviour is to stop loudly — a silently dropped row
    would hide exactly the incident someone needs to know about.
    """


def delete_document(user: str, document_id: str) -> int:
    """Remove a document, its chunks and therefore its retrievability.

    FR-D3: deletion removes the embeddings, not merely the source. A document
    you deleted that still answers questions is not deleted.
    """
    removed = 0
    while True:
        batch_docs = list(
            chunks(user)
            .where(filter=firestore.FieldFilter("documentId", "==", document_id))
            .limit(400)
            .stream()
        )
        if not batch_docs:
            break
        batch = db.batch()
        for doc in batch_docs:
            batch.delete(doc.reference)
        batch.commit()
        removed += len(batch_docs)

    documents(user).document(document_id).delete()
    return removed


def list_documents(user: str, limit: int = 100) -> list[dict]:
    return [
        {"id": d.id, **{k: v for k, v in (d.to_dict() or {}).items() if k != "ownerUid"}}
        for d in documents(user).order_by("createdAt", direction="DESCENDING").limit(limit).stream()
    ]
