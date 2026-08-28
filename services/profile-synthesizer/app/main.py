"""Consumes session.ended and writes what was learned to the profile.

On Cloud Run this is triggered by Eventarc delivering a Pub/Sub push. The same
endpoint serves locally, so the service has one shape everywhere.
"""

from __future__ import annotations

from fastapi import FastAPI, Response
from google.cloud import firestore

from .events import PushEnvelope
from .firestore import db, preferences, sessions
from .generalise import Proposal, generalise
from .memory_bank import propose_from_bank
from .synth import Standing, plan_commit

app = FastAPI(title="AllTheWay profile synthesizer")


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


def _standing(uid: str, own_id: str) -> list[Standing]:
    rows: list[Standing] = []
    for snap in preferences(uid).stream():
        if snap.id == own_id:
            continue
        data = snap.to_dict() or {}
        # A reverted row is already retired. Counting it as standing would
        # let a rejected inference keep strengthening the next write.
        if data.get("revertedAt") is not None:
            continue
        rows.append(
            Standing(
                id=snap.id,
                key=str(data.get("key") or ""),
                area=str(data.get("area") or ""),
                was=str(data.get("was") or ""),
                now=str(data.get("now") or ""),
                hat=data.get("hat") or None,
                source=str(data.get("source") or "session"),
            )
        )
    return rows


@app.post("/events")
def handle(envelope: PushEnvelope, response: Response) -> dict:
    payload = envelope.payload()
    uid = payload.get("userId")
    session_id = payload.get("sessionId")

    if not uid or not session_id:
        return {"status": "dropped", "reason": "missing userId or sessionId"}

    snap = sessions(uid).document(session_id).get()
    if not snap.exists:
        return {"status": "dropped", "reason": "session not found"}

    session = snap.to_dict() or {}
    correction = session.get("correction")
    if not isinstance(correction, dict):
        return {"status": "nothing_learned", "reason": "session had no correction"}

    hat = correction.get("hat") or None
    if hat not in (None, "work", "home", "church"):
        hat = None

    own_id = f"session-{session_id}"
    standing = _standing(uid, own_id)
    planned = plan_commit(
        was=correction.get("was", ""),
        now=correction.get("now", ""),
        standing=standing,
        own_id=own_id,
        hat=hat,
    )
    if planned is None:
        return {"status": "nothing_learned", "reason": "correction was empty or a no-op"}

    # One batch so a crash cannot retire the old row without writing the new
    # one — that would be worse than two opposites: no standing fact at all.
    ref = preferences(uid).document(own_id)
    now = firestore.SERVER_TIMESTAMP
    batch = db.batch()
    for revoked_id in planned.revoke_ids:
        # Never revoke a human row from a synth write; this loop is the
        # session correction's own keyed revoke.
        batch.set(
            preferences(uid).document(revoked_id),
            {"revertedAt": now, "supersededBy": own_id},
            merge=True,
        )
    payload = {
        "area": planned.learned.area,
        "was": planned.learned.was,
        "now": planned.learned.now,
        "evidence": planned.learned.evidence,
        "key": planned.key,
        "source": "session",
        "proposed": False,
        "revertedAt": None,
        "supersededBy": None,
        "sourceSessionId": session_id,
        "synthesisedAt": firestore.SERVER_TIMESTAMP,
    }
    if hat:
        payload["hat"] = hat
    batch.set(ref, payload)
    batch.commit()

    after = [Standing(id=own_id, key=planned.key, area=planned.learned.area, was=planned.learned.was, now=planned.learned.now, hat=hat, source="session"), *standing]
    # Sleep-time looks at every hat group, not only the hat of this
    # correction — otherwise a home correction would leave a work pattern
    # unproposed until the next work session.
    proposed = _commit_proposals(uid, generalise(standing=after) + propose_from_bank(uid))

    return {
        "status": "learned",
        "preferenceId": ref.id,
        "area": planned.learned.area,
        "key": planned.key,
        "revoked": list(planned.revoke_ids),
        "proposed": [p.key for p in proposed],
    }


def _commit_proposals(uid: str, proposals: list[Proposal]) -> list[Proposal]:
    """New synth rows only. Never a session-* id, never an overwrite."""

    if not proposals:
        return []
    existing_keys = set()
    existing_ids = set()
    for snap in preferences(uid).stream():
        existing_ids.add(snap.id)
        data = snap.to_dict() or {}
        if data.get("key"):
            existing_keys.add(data["key"])

    written: list[Proposal] = []
    for proposal in proposals:
        if proposal.key in existing_keys:
            continue
        doc_id = proposal.key.replace(":", "-")[:80]
        if doc_id.startswith("session-") or doc_id in existing_ids:
            continue
        payload = {
            "area": proposal.area,
            "was": proposal.was,
            "now": proposal.now,
            "evidence": proposal.evidence,
            "key": proposal.key,
            "source": "synth",
            "confidence": proposal.confidence,
            "proposed": proposal.proposed,
            "revertedAt": None,
            "supersededBy": None,
            "synthesisedAt": firestore.SERVER_TIMESTAMP,
        }
        if proposal.hat:
            payload["hat"] = proposal.hat
        preferences(uid).document(doc_id).set(payload)
        existing_ids.add(doc_id)
        existing_keys.add(proposal.key)
        written.append(proposal)
    return written
