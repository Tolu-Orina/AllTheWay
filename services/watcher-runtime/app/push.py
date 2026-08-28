"""Sending notifications.

FCM HTTP v1, called with the service's own identity. No VAPID private key lives
here: for *sending*, Firebase authenticates the sender by service account, and
the VAPID pair only exists so the browser can verify the push came from this
application. That asymmetry is worth stating, because "generate VAPID keys" is
usually followed by "and put the private key in the server", which here would be
a secret stored for nothing.

## One send per device, and dead ones are cleaned up

A person has a token per browser. FCM answers per token, and the two answers
that mean "this browser is gone" — UNREGISTERED and INVALID_ARGUMENT — cause the
token to be deleted immediately. Left in place they make every future send
report failures, and a send that always reports failures is a send nobody reads.

## Never raises into the sweep

A failed notification must not cost somebody else theirs, and must not cause a
Pub/Sub redelivery that re-notifies everyone the first pass reached.
"""

from __future__ import annotations

import logging
import os

import httpx

from .firestore import user_doc

log = logging.getLogger("watcher-runtime.push")

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
TIMEOUT_SECONDS = 15.0

#: FCM's answers meaning the registration is gone for good. Anything else —
#: quota, unavailability, a network blip — is transient and the token stays.
DEAD = ("UNREGISTERED", "INVALID_ARGUMENT")


def _token() -> str:
    import google.auth
    import google.auth.transport.requests

    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/firebase.messaging"]
    )
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token


def tokens_for(uid: str) -> list[str]:
    try:
        docs = user_doc(uid).collection("pushTokens").get()
    except Exception:  # noqa: BLE001 - a user with unreadable tokens gets no push
        return []
    return [str((d.to_dict() or {}).get("token") or d.id) for d in docs]


def _forget(uid: str, token: str) -> None:
    try:
        user_doc(uid).collection("pushTokens").document(token).delete()
    except Exception:  # noqa: BLE001 - cleanup is best-effort
        log.warning("could not remove a dead push token")


def send(
    uid: str,
    *,
    body: str,
    tag: str,
    url: str = "/app",
    urgency: str = "normal",
    ttl: str = "43200",
) -> int:
    """Notify one user. Returns how many devices were reached.

    Sent as `data`, not `notification`: our own service worker renders it, so the
    shape is ours and the payload cannot set options we did not intend.
    """
    if not PROJECT:
        return 0

    tokens = tokens_for(uid)
    if not tokens:
        return 0

    try:
        access_token = _token()
    except Exception:  # noqa: BLE001 - no credential, no push, no crash
        log.exception("could not authenticate to FCM")
        return 0

    fcm_url = f"https://fcm.googleapis.com/v1/projects/{PROJECT}/messages:send"
    reached = 0

    with httpx.Client(timeout=TIMEOUT_SECONDS) as http:
        for token in tokens:
            try:
                response = http.post(
                    url=fcm_url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    json={
                        "message": {
                            "token": token,
                            "data": {
                                "title": "AllTheWay",
                                "body": body,
                                "url": url,
                                "tag": tag,
                            },
                            "webpush": {
                                "headers": {
                                    "TTL": ttl,
                                    "Urgency": urgency,
                                }
                            },
                        }
                    },
                )
            except httpx.HTTPError:
                log.warning("push delivery failed for a device")
                continue

            if response.status_code == 200:
                reached += 1
                continue

            detail = response.text[:300]
            if any(marker in detail for marker in DEAD):
                _forget(uid, token)
            else:
                log.warning("push rejected: HTTP %s", response.status_code)

    return reached


def send_digest(uid: str, waiting: int) -> int:
    """Notify one user. Returns how many devices were reached.

    The wording is the design. "2 things need your decision" is actionable from
    a lock screen; "You have a new digest" is not, and a notification that says
    nothing specific is one people swipe away without reading — which trains
    them to swipe away the ones that matter.
    """
    if waiting == 0:
        # Nothing needs a person. Sending anyway would be a daily interruption
        # that says "nothing to do", which is how notifications get turned off.
        return 0

    body = (
        "1 thing needs your decision."
        if waiting == 1
        else f"{waiting} things need your decision."
    )
    return send(uid, body=body, tag="alltheway-digest", url="/app", urgency="normal", ttl="43200")


def leave_copy(title: str, minutes: int) -> str:
    """Lock-screen copy for leave-now. Never "You have a notification"."""
    label = title.strip() or "pickup"
    if minutes <= 0:
        return f"Leave for {label} now."
    return f"Leave for {label} in {minutes} minutes."


def send_leave(uid: str, title: str, minutes: int) -> int:
    """Leave-now. High urgency, short TTL — a late pickup notice is noise."""
    return send(
        uid,
        body=leave_copy(title, minutes),
        tag="alltheway-leave",
        url="/app",
        urgency="high",
        ttl="120",
    )
