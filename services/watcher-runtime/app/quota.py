"""Whether one more watcher run is permitted.

Checked before the orchestrator is called, never after. A run that has already
spent a model turn cannot unspend it, so a limit discovered afterwards is a
limit that did not protect anyone.

An unreadable subscription is Free, never unmetered — the same strict
direction connector-gateway uses. A Firestore blip that resolved everyone to
Team would be an outage that also gave away the product.
"""

from __future__ import annotations

from alltheway_metering import Meter, check, effective_tier, period

from .firestore import db


def watcher_runs_allowed(uid: str) -> bool:
    try:
        plan = db.collection("subscriptions").document(uid).get()
        data = plan.to_dict() if plan.exists else None
    except Exception:  # noqa: BLE001 — unreadable plan is Free, not Team
        data = None

    tier = effective_tier(data)

    used = 0
    try:
        usage = db.collection("usage").document(f"{uid}::{period()}").get()
        if usage.exists:
            value = usage.get("watcher_runs")
            if isinstance(value, (int, float)):
                used = int(value)
    except Exception:  # noqa: BLE001 — no counters read means nothing spent
        used = 0

    return check(tier=tier, meter=Meter.WATCHER_RUNS, used=used).allowed
