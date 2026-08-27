"""Whether one more document may be stored.

Counted at ingest against the number currently stored — not a monthly
counter. Delete frees a slot. Enforced here so a caller cannot route around
the gateway's pre-check.
"""

from __future__ import annotations

from alltheway_metering import Meter, check, documents_refused_message, effective_tier

from . import store


def document_slot(user: str) -> tuple[bool, str]:
    try:
        plan = store.db.collection("subscriptions").document(user).get()
        data = plan.to_dict() if plan.exists else None
    except Exception:  # noqa: BLE001 — unreadable plan is Free
        data = None

    tier = effective_tier(data)
    used = store.count_documents(user)
    allowance = check(tier=tier, meter=Meter.DOCUMENTS, used=used)
    if allowance.allowed:
        return True, ""
    return False, documents_refused_message(allowance.tier)
