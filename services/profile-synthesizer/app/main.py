"""Consumes session.ended and writes what was learned to the profile.

On Cloud Run this is triggered by Eventarc delivering a Pub/Sub push. The same
endpoint serves locally, so the service has one shape everywhere.
"""

from __future__ import annotations

from fastapi import FastAPI, Response
from google.cloud import firestore

from .events import PushEnvelope
from .firestore import preferences, sessions
from .synth import synthesise

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
    if not correction:
        return {"status": "nothing_learned", "reason": "session had no correction"}

    own_id = f"session-{session_id}"

    # Count only preferences that are still standing: a reverted one means the
    # user rejected that inference, so it must not strengthen the evidence for
    # repeating it.
    #
    # This handler's own row is excluded. Pub/Sub is at-least-once, and without
    # this a redelivery counts the preference it wrote last time, inflating the
    # evidence on every retry ("4 times" -> "5 times" -> ...) for a correction
    # the user only ever made once.
    prior = sum(
        1
        for p in preferences(uid).stream()
        if p.id != own_id and (p.to_dict() or {}).get("revertedAt") is None
    )

    learned = synthesise(
        was=correction.get("was", ""),
        now=correction.get("now", ""),
        prior_corrections=prior,
    )
    if learned is None:
        return {"status": "nothing_learned", "reason": "correction was empty or a no-op"}

    # Keyed on the session, so replaying session.ended updates one row rather
    # than growing the profile on every redelivery.
    ref = preferences(uid).document(own_id)
    ref.set(
        {
            "area": learned.area,
            "was": learned.was,
            "now": learned.now,
            "evidence": learned.evidence,
            "revertedAt": None,
            "sourceSessionId": session_id,
            "synthesisedAt": firestore.SERVER_TIMESTAMP,
        }
    )

    return {"status": "learned", "preferenceId": ref.id, "area": learned.area}
