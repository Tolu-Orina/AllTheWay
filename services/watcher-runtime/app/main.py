"""HTTP surface. Receives Pub/Sub push deliveries, exactly as on Cloud Run."""

from __future__ import annotations

from fastapi import FastAPI, Response
from google.cloud import firestore

from .due import fanout_session_ended, scan_due
from .events import PushEnvelope
from .digest import sweep
from .firestore import preferences, runs, watchers
from .firestore import record_run
from .quota import watcher_runs_allowed
from .runtime import execute_run, now_iso

app = FastAPI(title="AllTheWay watcher runtime")


# Both spellings, deliberately.
#
# Google's frontend on *.run.app swallows the exact path `/healthz` — it
# returns Google's own 404 and the request never reaches the container (proven
# by its absence from the logs, while /api/... from the same probe appears).
# `/healthz/` gets through. FastAPI would answer that with a 307 redirect to
# the path that does not arrive, so the trailing-slash route is declared
# explicitly rather than left to redirect_slashes.
#
# Registering both means whoever writes the next probe cannot pick the wrong
# one. See open decision 7 in docs/AllTheWay-A2A-and-Platform-Plan.md.
@app.get("/healthz")
@app.get("/healthz/", include_in_schema=False)
def healthz() -> dict:
    return {"ok": True}


@app.post("/events/digest")
def handle_digest() -> dict:
    """The daily digest sweep.

    Always 200. A sweep that fails for one user has already recorded that in
    its counts, and asking Pub/Sub to redeliver would re-notify everyone the
    first pass succeeded for — turning one person's failure into everybody's
    duplicate.
    """
    return {"status": "swept", **sweep()}


@app.post("/events/due")
def handle_due() -> dict:
    """The five-minute due scan. One job, not N. Always 200 for the same
    reason as the digest: a failed row is counted, not retried as a whole
    sweep that would re-enqueue everyone else.
    """
    return {"status": "scanned", **scan_due()}


@app.post("/events/session-ended")
def handle_session_ended(envelope: PushEnvelope) -> dict:
    payload = envelope.payload()
    uid = payload.get("userId")
    session_id = payload.get("sessionId")
    if not uid or not session_id:
        return {"status": "dropped", "reason": "missing userId or sessionId"}
    return {"status": "fanned-out", **fanout_session_ended(str(uid), str(session_id))}


@app.post("/events")
def handle(envelope: PushEnvelope, response: Response) -> dict:
    payload = envelope.payload()
    uid = payload.get("userId")
    watcher_id = payload.get("watcherId")

    if not uid or not watcher_id:
        # Malformed messages are acknowledged, never retried: Pub/Sub would
        # redeliver forever and the message will never become valid.
        return {"status": "dropped", "reason": "missing userId or watcherId"}

    delivery_id = envelope.delivery_id()
    run_id = payload.get("runId") or delivery_id or f"{watcher_id}-{now_iso()}"
    run_ref = runs(uid).document(str(run_id))

    # Pub/Sub is at-least-once. Keying the run document on the payload runId
    # (watcher + due instant) makes a redelivery a no-op instead of a
    # duplicate run. messageId is the fallback when the publisher is older.
    if run_ref.get().exists:
        return {"status": "duplicate", "runId": run_ref.id}

    snap = watchers(uid).document(watcher_id).get()
    if not snap.exists:
        return {"status": "dropped", "reason": "watcher not found"}

    watcher = snap.to_dict() or {}
    prefs = [
        p.to_dict().get("now", "")
        for p in preferences(uid).stream()
        if (p.to_dict() or {}).get("revertedAt") is None
    ]

    try:
        outcome = execute_run(
            watcher=watcher,
            trigger_detail=payload.get("detail", watcher.get("trigger", "")),
            preferences=[p for p in prefs if p],
            quota=lambda: watcher_runs_allowed(uid),
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the ledger, not swallowed
        # 500 tells Pub/Sub to retry: a transient orchestrator failure should
        # not silently lose the run.
        response.status_code = 500
        return {"status": "error", "reason": str(exc)[:200]}

    run_ref.set(
        {
            "watcherId": watcher_id,
            "name": watcher.get("name", "Watcher"),
            "detail": outcome.detail,
            "state": outcome.state,
            "reason": outcome.reason,
            "plan": outcome.plan,
            # Persisted so a blocked run is visible in the Transparent Trace,
            # not merely prevented. Carries no screened content.
            "trace": outcome.trace,
            "sessionId": payload.get("sessionId") or "",
            "at": firestore.SERVER_TIMESTAMP,
        }
    )

    if outcome.counts_as_run:
        watchers(uid).document(watcher_id).update({"lastRunAt": firestore.SERVER_TIMESTAMP})
        # Metered only when the watcher actually ran. A skipped or
        # quota-blocked run consumed nothing and must not consume an
        # allowance either.
        record_run(uid)

    return {
        "status": outcome.state,
        "runId": run_ref.id,
        "reason": outcome.reason,
        "trace": outcome.trace,
    }
