"""Brand memory, read at the moment of generation.

## Why it is read here rather than passed in

The alternative is for the caller to send a `style` argument. That would make
the remembered look something a caller can *state*, and a caller that can state
its own style can state anyone's. It is the same reasoning that keeps the plan
tier out of the request body: anything read from the caller is something the
caller can choose.

So the preference is read from the user's own subtree, inside the enforcement
point, at the moment it is applied.

## It is appended, never merged

The style text is added after the user's prompt rather than woven into it. A
remembered preference must be able to change how something looks and never what
it is — and text concatenated after a request cannot quietly rewrite the
request. A wrong preference then costs an ugly image rather than the wrong one.

## An unreadable preference is no preference

Every failure here returns "". Brand memory is a convenience, and refusing to
draw anything because a palette could not be loaded would trade a small
degradation for a total one.
"""

from __future__ import annotations

import os
from typing import Protocol


class VisualStore(Protocol):
    def style_for(self, user: str) -> str: ...


class NoVisualPreferences:
    """Local runs and tests. Remembers nothing, which is the honest default."""

    def style_for(self, user: str) -> str:
        return ""


class FirestoreVisualPreferences:
    """Reads `users/{uid}/visualPreferences`, written by the gateway.

    Path-scoped under the user, like every other collection holding something a
    person made. A palette is as much a fingerprint of a company's work as a
    contract is, and it gets the same isolation rather than a weaker one because
    it happens to be small.
    """

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore

        self._db = firestore.Client(
            project=project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        )

    def style_for(self, user: str) -> str:
        if not user:
            return ""
        try:
            docs = (
                self._db.collection("users")
                .document(user)
                .collection("visualPreferences")
                .get()
            )
        except Exception:  # noqa: BLE001 — see the module docstring
            return ""

        clauses: list[str] = []
        for doc in docs:
            data = doc.to_dict() or {}
            # Reverted preferences stay in Firestore and stop being applied.
            # The row is the record that it was learned and corrected; only the
            # stamp decides whether it still counts.
            if data.get("revertedAt"):
                continue
            value = str(data.get("value", "")).strip()
            if not value:
                continue
            swatches = [str(s) for s in (data.get("swatches") or []) if str(s).strip()]
            clauses.append(f"{value} ({', '.join(swatches)})" if swatches else value)

        if not clauses:
            return ""
        return "Follow these visual preferences: " + "; ".join(clauses) + "."


def default_visual_store() -> VisualStore:
    """Firestore in a deployed service, nothing locally.

    Mirrors `default_store()` for subscriptions, including its failure
    direction: with no project or no client, nothing is remembered. A generation
    that ignores a palette is a small disappointment; one that cannot run
    because a palette could not be read is an outage.
    """
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return NoVisualPreferences()
    try:
        return FirestoreVisualPreferences()
    except Exception:  # pragma: no cover - absent client or credentials
        return NoVisualPreferences()
