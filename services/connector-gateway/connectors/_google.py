"""What every Google connector needs, in one place.

Four connectors making the same authenticated request in four slightly
different ways is four chances to get the credential guard wrong. The guard is
the thing that must not vary: a connector that reaches Google without a token
is a connector making an unauthenticated call on a user's behalf.

Imported by the connector processes only. The Agent Gateway never loads this —
it hands a token in and reads JSON back.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

#: Set by the Agent Gateway for the duration of one call, and nothing else is
#: passed in. Absent means the gateway failed to resolve a credential, which it
#: treats as a consent problem long before it gets here — so this is a guard
#: against a bug, not a path anyone should reach.
TOKEN_ENV = "GOOGLE_OAUTH_ACCESS_TOKEN"

TIMEOUT = 15.0


def fail(message: str, **extra: Any) -> str:
    return json.dumps({"error": message, **extra})


def ok(**payload: Any) -> str:
    return json.dumps(payload)


def request(method: str, url: str, **kwargs: Any) -> tuple[int, Any]:
    """One authenticated call. Returns (status, parsed body) and never raises.

    Google's failure modes are ordinary — a deleted file, a revoked scope, a
    rate limit — and each is more useful to the caller as JSON it can act on
    than as an MCP transport error that reads as "the connector is broken".
    """
    token = os.environ.get(TOKEN_ENV, "")
    if not token:
        return 401, {"error": "No access token was supplied to this connector."}

    try:
        with httpx.Client(timeout=TIMEOUT) as http:
            response = http.request(
                method, url, headers={"Authorization": f"Bearer {token}"}, **kwargs
            )
    except httpx.HTTPError as exc:
        return 503, {"error": f"Could not reach Google: {type(exc).__name__}"}

    if response.status_code == 204:
        return 204, {}
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {"error": "Google returned a non-JSON response."}


def message_from(payload: Any, fallback: str) -> str:
    """Google's error shape, without assuming it.

    A connector that indexes blindly into another company's error document
    raises a KeyError instead of reporting the failure it was handed.
    """
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(error, str):
            return error
    return fallback


def capped(value: int, ceiling: int = 50) -> int:
    """Bounded here as well as at the gateway.

    A connector that will happily return ten thousand rows is one bad argument
    away from an enormous model prompt.
    """
    try:
        return max(1, min(int(value), ceiling))
    except (TypeError, ValueError):
        return 1
