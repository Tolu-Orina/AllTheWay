"""Firestore access.

Duplicated deliberately across services rather than shared: each is an
independently deployable Cloud Run unit, and fifteen lines of boilerplate is a
better trade than a shared package every image has to carry.
"""

import logging
import os

from google.cloud import firestore

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "alltheway-local")

db = firestore.Client(project=PROJECT)


def user_doc(uid: str):
    return db.collection("users").document(uid)


def watchers(uid: str):
    return user_doc(uid).collection("watchers")


def runs(uid: str):
    return user_doc(uid).collection("runs")


def sessions(uid: str):
    return user_doc(uid).collection("sessions")


def preferences(uid: str):
    return user_doc(uid).collection("preferences")


def record_run(uid: str) -> None:
    """Count one watcher run against this month's allowance.

    Watcher runs are one of the two dimensions with real marginal cost — an
    unattended turn plus whatever connector calls it makes — so they are
    metered, and metered here because this is where a run actually completes.

    Counted after the run, never before: charging for a run that never happened
    would let a failing trigger burn someone's allowance.

    A lost count does not fail the run. The work already happened and the user
    already has it; refusing to acknowledge that because a counter could not be
    written would be the wrong trade. It is logged instead, because a meter
    that silently stops counting is a billing problem nobody notices.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    period = f"{now.year:04d}-{now.month:02d}"
    try:
        db.collection("usage").document(f"{uid}::{period}").set(
            {"watcher_runs": firestore.Increment(1)}, merge=True
        )
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).error("could not record watcher run for %s: %s", uid, exc)
