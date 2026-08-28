"""The due-scan and the session-ended fan-out.

One Cloud Scheduler job publishes watcher-due every five minutes. This handler
finds at most 50 due rows and publishes watcher-trigger for each. It does not
run the watcher itself.

nextRunAt is advanced after a successful publish, not before: a crash between
the two retries the same due instant, and execute_run keys the run document on
runId = watcherId + that instant, so a retry is a no-op rather than a double
run.

The instruction never lives on watcherSchedule. This module must not read it
from there either — a future edit that 'helpfully' copies the text onto the
pointer would put user corpus on a project-wide collection.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .firestore import db, watchers
from .publish import publish_trigger

log = logging.getLogger("watcher-runtime.due")

MAX_DUE = 50
MIN_INTERVAL_MINUTES = 60


def _iso(value: Any) -> str:
    if hasattr(value, "isoformat"):
        moment = value
        if getattr(moment, "tzinfo", None) is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.isoformat()
    if hasattr(value, "timestamp"):
        return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc).isoformat()
    return str(value)


def run_id(watcher_id: str, next_run_at: Any) -> str:
    return f"{watcher_id}+{_iso(next_run_at)}"


def _as_datetime(value: Any) -> datetime:
    if hasattr(value, "timestamp") and not hasattr(value, "isoformat"):
        return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    raise TypeError("nextRunAt is not a timestamp")


def scan_due(now: datetime | None = None) -> dict[str, int]:
    """One pass over due schedule pointers. Always bounded."""
    at = now or datetime.now(timezone.utc)
    enqueued = 0
    failed = 0
    seen = 0

    query = (
        db.collection("watcherSchedule")
        .where("running", "==", True)
        .where("nextRunAt", "<=", at)
        .limit(MAX_DUE)
    )

    for snap in query.stream():
        seen += 1
        data = snap.to_dict() or {}
        if "instruction" in data:
            # Pointers only. If this fires, someone wrote corpus onto the index.
            log.error("watcherSchedule %s carries instruction text; refusing to enqueue", snap.id)
            failed += 1
            continue

        uid = data.get("uid")
        watcher_id = data.get("watcherId")
        next_run = data.get("nextRunAt")
        interval = data.get("intervalMinutes") or 1440
        if not uid or not watcher_id or next_run is None:
            failed += 1
            continue
        if not isinstance(interval, (int, float)) or interval < MIN_INTERVAL_MINUTES:
            interval = 1440

        payload = {
            "userId": uid,
            "watcherId": watcher_id,
            "runId": run_id(str(watcher_id), next_run),
            "detail": "Scheduled run is due.",
        }
        try:
            publish_trigger(payload)
            nxt = _as_datetime(next_run)
            snap.reference.update({"nextRunAt": nxt + timedelta(minutes=int(interval))})
            enqueued += 1
        except Exception:  # noqa: BLE001 — one row must not break the sweep
            failed += 1
            log.exception("due enqueue failed")

    if seen == MAX_DUE:
        log.error(
            "due scan hit its cap of %s rows; the rest wait for the next tick.",
            MAX_DUE,
        )

    return {"seen": seen, "enqueued": enqueued, "failed": failed}


def fanout_session_ended(uid: str, session_id: str) -> dict[str, int]:
    """Enqueue every running session_ended watcher for this user.

    Filtered in memory: one user's watchers are a short list, and a composite
    on users/{uid}/watchers is not worth the extra index for this.
    """
    enqueued = 0
    failed = 0
    for snap in watchers(uid).stream():
        data = snap.to_dict() or {}
        if not data.get("running"):
            continue
        if data.get("triggerKind") != "session_ended":
            continue
        try:
            publish_trigger(
                {
                    "userId": uid,
                    "watcherId": snap.id,
                    "sessionId": session_id,
                    "runId": f"{snap.id}+{session_id}",
                    "detail": "A piece of work ended.",
                }
            )
            enqueued += 1
        except Exception:  # noqa: BLE001
            failed += 1
            log.exception("session-ended enqueue failed")
    return {"enqueued": enqueued, "failed": failed}


def scan_reminders(now: datetime | None = None) -> dict[str, int]:
    """Fire due leave-now reminders. Bounded, never raises into the sweep.

    Pointers only on reminderDue. Instruction text (the title) lives under the
    user. Claim-then-send: a retry after a crash does not double-notify because
    the pointer is deleted and the reminder is marked fired first.
    """
    from google.cloud import firestore as fs

    from .firestore import reminder_due, reminders
    from .push import send_leave

    at = now or datetime.now(timezone.utc)
    fired = 0
    failed = 0
    seen = 0

    query = reminder_due().where("fireAt", "<=", at).limit(MAX_DUE)
    for snap in query.stream():
        seen += 1
        data = snap.to_dict() or {}
        if "instruction" in data:
            log.error("reminderDue %s carries instruction text; refusing", snap.id)
            failed += 1
            continue
        uid = data.get("uid")
        reminder_id = data.get("reminderId")
        if not uid or not reminder_id:
            failed += 1
            continue
        try:
            rem_ref = reminders(str(uid)).document(str(reminder_id))
            rem = rem_ref.get()
            if not rem.exists:
                snap.reference.delete()
                continue
            payload = rem.to_dict() or {}
            state = payload.get("state")
            if state != "scheduled":
                snap.reference.delete()
                continue
            title = str(payload.get("title") or "pickup")
            fire_at = data.get("fireAt")
            minutes = 0
            try:
                due = _as_datetime(fire_at)
                minutes = max(0, int(round((due - at).total_seconds() / 60)))
            except (TypeError, ValueError):
                minutes = 0
            rem_ref.update({"state": "fired", "firedAt": fs.SERVER_TIMESTAMP})
            snap.reference.delete()
            send_leave(str(uid), title, minutes)
            fired += 1
        except Exception:  # noqa: BLE001 — one row must not break the sweep
            failed += 1
            log.exception("reminder fire failed")

    if seen == MAX_DUE:
        log.error(
            "reminder scan hit its cap of %s rows; the rest wait for the next tick.",
            MAX_DUE,
        )

    return {"seen": seen, "fired": fired, "failed": failed}
