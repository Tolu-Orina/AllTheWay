"""The audit trail for exceptions to the autonomy floor.

FR-W4 lets an org waive the irreversible-action floor "with an auditable
justification". This is the auditable part, and it has one job: make sure that
every time the floor was set aside, there is a record of who did it, for what,
and why — written *before* the thing happened.

## Written before the call, always

A waiver recorded after a successful call is a record of the calls that
succeeded. The interesting ones are the calls that were attempted: a waiver
used to attempt something that then failed is exactly the event an auditor
wants, and it is the one a write-on-success would lose.

## A failed write does not fail the call

Deliberate, and the opposite of the screening decision, so the difference is
worth stating. Screening fails closed because passing unscreened content
through defeats the control. Auditing is a record of a decision the policy
engine has already made correctly — refusing the call because the log is
unavailable would let a Firestore blip stop every waivered action in the
product, while protecting nothing.

Instead the failure is logged loudly, so a missing audit trail is visible as an
incident rather than as silence.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from alltheway_policy import Waiver

log = logging.getLogger(__name__)

COLLECTION = "waiverAudit"

#: Set to disable the write in environments with no Firestore. Absent means
#: "write it", so forgetting to configure something never silently disables
#: the audit trail.
DISABLED_ENV = "AUDIT_DISABLED"


def _client():
    from google.cloud import firestore

    return firestore.Client(project=os.environ.get("GOOGLE_CLOUD_PROJECT"))


def record_waiver(
    *, org: str, user: str, connector: str, tool: str, waiver: Waiver
) -> bool:
    """Record one use of a waiver. Returns whether it was written."""
    if os.environ.get(DISABLED_ENV) == "true":
        return False

    entry: dict[str, Any] = {
        "org": org,
        "user": user,
        "connector": connector,
        "tool": tool,
        "grantedBy": waiver.granted_by,
        # The justification is the whole point of the record. Stored in full:
        # a truncated reason is a reason nobody can evaluate later.
        "justification": waiver.justification,
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    try:
        _client().collection(COLLECTION).add(entry)
        return True
    except Exception as exc:  # noqa: BLE001 — an unwritable log must not stop policy
        # Loud, unlike most swallowed exceptions in this codebase. A missing
        # audit trail is an incident; logging it at debug would hide exactly
        # the thing an auditor would later ask about.
        log.error(
            "waiver audit write failed for %s/%s by %s: %s",
            connector,
            tool,
            waiver.granted_by,
            exc,
        )
        return False
