"""What plan a user is on, and what they have already spent this month.

Read here rather than passed in with the call. A caller that supplied its own
tier would be a caller that could grant itself an upgrade, and the whole point
of enforcing limits beside the autonomy floor is that the acting path cannot
route around them.

## Counting happens after the call succeeds

The same rule the per-connector quota already follows: charging for refused
calls would let a caller exhaust its own allowance by being denied, which turns
a rate limit into a denial-of-service against the person it protects.

## An unreadable subscription is Free, never unmetered

The strict direction. A Firestore outage that resolved everyone to Team would
be an outage that also gave away the product.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

from alltheway_metering import DEFAULT_TIER, Meter, Tier, effective_tier, period


@dataclass(frozen=True)
class Subscription:
    tier: Tier
    used: dict[Meter, int]

    def usage(self, meter: Meter) -> int:
        return self.used.get(meter, 0)


FREE = Subscription(tier=DEFAULT_TIER, used={})


class SubscriptionStore(Protocol):
    def read(self, user: str) -> Subscription: ...

    def record(self, user: str, meter: Meter, amount: int) -> None: ...


@dataclass
class InMemorySubscriptions:
    """Tests and local runs."""

    subscriptions: dict[str, Subscription]

    def read(self, user: str) -> Subscription:
        return self.subscriptions.get(user, FREE)

    def record(self, user: str, meter: Meter, amount: int) -> None:
        current = self.subscriptions.get(user, FREE)
        used = dict(current.used)
        used[meter] = used.get(meter, 0) + amount
        self.subscriptions[user] = Subscription(tier=current.tier, used=used)


class FirestoreSubscriptions:
    """The real store.

    Two documents, deliberately. The plan is durable and changes when someone
    pays; the counters are per-period and reset by writing to a new one. Keeping
    them together would mean a monthly reset rewrites the subscription, which is
    the document you least want to touch on a schedule.
    """

    PLANS = "subscriptions"
    USAGE = "usage"

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore

        self._firestore = firestore
        self._db = firestore.Client(
            project=project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        )

    def _usage_id(self, user: str) -> str:
        return f"{user}::{period()}"

    def read(self, user: str) -> Subscription:
        try:
            plan_doc = self._db.collection(self.PLANS).document(user).get()
            data = plan_doc.to_dict() if plan_doc.exists else None
        except Exception:  # noqa: BLE001 — an unreadable plan is Free, not Team
            data = None

        tier = effective_tier(data)

        used: dict[Meter, int] = {}
        try:
            usage_doc = self._db.collection(self.USAGE).document(self._usage_id(user)).get()
            if usage_doc.exists:
                for meter in Meter:
                    value = usage_doc.get(str(meter))
                    if isinstance(value, (int, float)):
                        used[meter] = int(value)
        except Exception:  # noqa: BLE001
            # No counters read means "nothing spent", which is the permissive
            # direction — accepted deliberately, because the alternative is
            # refusing every call in the product during a Firestore blip.
            used = {}

        return Subscription(tier=tier, used=used)

    def record(self, user: str, meter: Meter, amount: int) -> None:
        if amount <= 0:
            return
        try:
            self._db.collection(self.USAGE).document(self._usage_id(user)).set(
                {str(meter): self._firestore.Increment(amount)}, merge=True
            )
        except Exception:  # noqa: BLE001 — a lost count must not fail a completed call
            pass


def default_store() -> SubscriptionStore | None:
    """Firestore in a deployed service, nothing locally.

    None means every user reads as Free with nothing spent, which is what makes
    the local path runnable without a database — and Free is the strict end, so
    a misconfigured deployment under-serves rather than over-serves.
    """
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return None
    try:
        return FirestoreSubscriptions()
    except Exception:  # pragma: no cover - absent client or credentials
        return None
