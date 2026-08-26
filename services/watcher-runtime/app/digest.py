"""The daily digest sweep.

The scheduler publishes one message a day. This turns it into one digest per
user, and its only job is deciding *whether to notify* — never what the digest
says.

## Content is not built here, deliberately

The digest a person reads is computed by the gateway from the ledger and the
runs at the moment they open it. This handler does not duplicate that, because
the plan's own acceptance criterion is that the digest reconciles with the
ledger, and a copy written at 07:00 has already drifted by 09:15.

So what is written here is a single field: `sentAt`. It exists so a retried
delivery does not buzz someone's phone twice at 07:01.

## Users are enumerated, not listed in the schedule

A schedule holding a user list is a schedule that is wrong the moment somebody
signs up. The sweep reads the users collection instead — a root query, and a
legitimate one: this is a system process doing per-tenant work, not one tenant
reaching another's data. Nothing about a user's content is read here.

## Bounded, and honest about the bound

`MAX_USERS_PER_SWEEP` caps one invocation. Past that, this needs to publish a
continuation message per user rather than looping — a fan-out. The cap is here
so the failure at scale is a truncated sweep that logs loudly, rather than a
request that times out halfway with no record of where it stopped.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from .firestore import db, user_doc
from .push import send_digest

log = logging.getLogger("watcher-runtime.digest")

#: One invocation's budget. See the module docstring: beyond this the design
#: needs a fan-out, and the cap makes that need visible instead of silent.
MAX_USERS_PER_SWEEP = 500


def digest_date(now: datetime | None = None) -> str:
    """yyyy-mm-dd in UTC, matching every other period key in this system."""
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")


def mark_sent(uid: str, now: datetime | None = None) -> bool:
    """Record that today's notification went out. False if it already had.

    The check and the write are not a transaction, and do not need to be: two
    racing sweeps would both send at most one notification each, which is the
    same outcome as one sweep sending once. A transaction here would buy
    nothing and cost a round trip per user.
    """
    ref = user_doc(uid).collection("digest").document(digest_date(now))
    snapshot = ref.get()
    if snapshot.exists and snapshot.get("sentAt"):
        return False

    ref.set({"sentAt": now or datetime.now(timezone.utc)}, merge=True)
    return True


def awaiting_count(uid: str, now: datetime | None = None) -> int:
    """How many things are still waiting on this person.

    ## This duplicates a rule the gateway also implements

    The digest a user *reads* is built by the gateway from the same two
    collections. This is a second implementation of one part of it, and that is
    a drift risk of exactly the kind that produced a Max subscriber reading as
    Free on their own usage page.

    It is accepted here, narrowly, because the alternatives are worse: the
    gateway is the public service and reaching it from here would mean adding a
    service-to-service trust path to the most exposed thing in the system, for a
    number.

    The three rules are therefore written out rather than paraphrased, and they
    are the whole definition:

      1. a run in the last 24 hours
      2. whose status is awaiting_confirmation
      3. whose session does not already appear in the ledger

    Rule 3 is the one that matters. A notification asking someone to decide
    something they decided last night is the digest disagreeing with the record,
    which the plan calls worse than no digest at all.
    """
    at = now or datetime.now(timezone.utc)
    window = at - timedelta(hours=24)

    try:
        runs = (
            user_doc(uid)
            .collection("runs")
            .where("status", "==", "awaiting_confirmation")
            .limit(50)
            .get()
        )
    except Exception:  # noqa: BLE001 - no count rather than a broken sweep
        return 0

    pending = []
    for run in runs:
        data = run.to_dict() or {}
        run_at = data.get("at")
        if run_at is None or run_at.replace(tzinfo=timezone.utc) < window:
            continue
        pending.append(str(data.get("sessionId") or ""))

    if not pending:
        return 0

    try:
        decided = {
            str((entry.to_dict() or {}).get("sessionId") or "")
            for entry in user_doc(uid).collection("ledger").limit(50).get()
        }
    except Exception:  # noqa: BLE001
        decided = set()

    return sum(1 for session in pending if session not in decided)


def sweep(now: datetime | None = None) -> dict:
    """One pass over every user. Returns what happened, for the log.

    Never raises for a single user's failure: one unreadable document must not
    cost everybody else their digest. The count of failures is returned rather
    than swallowed, so a systemic problem shows up as a number rather than as
    silence.
    """
    notified = 0
    already = 0
    failed = 0
    seen = 0

    for snapshot in db.collection("users").limit(MAX_USERS_PER_SWEEP).stream():
        seen += 1
        try:
            if mark_sent(snapshot.id, now):
                # Marked first, sent second. The other order would re-notify
                # everyone on a redelivery if the send succeeded and the write
                # did not — and a duplicate 07:01 buzz reads as a broken
                # product in a way a missed one does not.
                send_digest(snapshot.id, awaiting_count(snapshot.id, now))
                notified += 1
            else:
                already += 1
        except Exception:  # noqa: BLE001 - one user must not break the sweep
            failed += 1
            log.exception("digest failed for a user")

    if seen == MAX_USERS_PER_SWEEP:
        # Loud, because the symptom otherwise is "some people stopped getting
        # digests" — which looks like a delivery bug rather than a cap.
        log.error(
            "digest sweep hit its cap of %s users; the rest were not reached. "
            "This needs a per-user fan-out.",
            MAX_USERS_PER_SWEEP,
        )

    return {"seen": seen, "notified": notified, "already": already, "failed": failed}
