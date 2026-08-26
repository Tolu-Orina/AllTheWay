"""Identity for service-to-service A2A calls.

Phase 1 item 1.4. Not optional hardening — without it the deployed system does
not work at all. Internal services run with INGRESS_TRAFFIC_INTERNAL_ONLY and
`run.invoker` granted per caller service account, so Cloud Run rejects any
request arriving without a valid Google-signed identity token.

Locally nothing requires auth, which is precisely why this was invisible until
there was a real project to deploy into.

## Verification is Cloud Run's, deliberately

This module only *attaches* a token. Cloud Run checks the signature, issuer and
audience, and enforces IAM, before the request reaches the container — which is
strictly stronger than checking it in application code, because a compromised
process cannot skip it. The card's `HTTPAuthSecurityScheme` (bearer) is an
honest description of that arrangement: the A2A layer and the IAM layer agree
rather than duplicating.

## Why it degrades instead of failing

If no token can be minted, the request goes out unauthenticated. That is not a
silent weakening:

  - in development there is no metadata server, and the local services require
    nothing, so failing hard would break every local run;
  - in production Cloud Run rejects the unauthenticated request anyway, so the
    boundary is unchanged.

The alternative — refusing to call — would defend a boundary the platform
already defends, at the cost of making the whole stack unrunnable offline.

## Why a shared library

Three services make A2A calls (gateway in TypeScript, orchestrator and watcher
runtime in Python). Two copies of an auth path drift, and the one that drifts is
the one nobody tested.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

#: How long a failed mint is remembered. See id_token_for.
_FAILURE_TTL_SECONDS = 30

#: Tokens are valid for an hour; refreshing a few minutes early avoids handing
#: Cloud Run a credential that expires mid-flight.
_SKEW_SECONDS = 300

#: audience -> (token or None, expiry). A None entry is a remembered
#: failure, which is why the value is optional.
_cache: dict[str, tuple[str | None, float]] = {}


def _now() -> float:
    import time

    return time.monotonic()


def id_token_for(audience: str) -> str | None:
    """A Google-signed OIDC identity token for `audience`, or `None`.

    The audience is the callee's base URL, which is what Cloud Run expects —
    hence one token per target rather than one globally.
    """
    hit = _cache.get(audience)
    if hit and hit[1] > _now():
        # A cached None is a remembered failure, and is returned as one.
        return hit[0]

    try:
        import google.auth.transport.requests
        import google.oauth2.id_token

        request = google.auth.transport.requests.Request()
        token = google.oauth2.id_token.fetch_id_token(request, audience)
    except Exception as exc:  # noqa: BLE001 — every failure means "call without one"
        # Debug, not warning: on a developer machine this is the normal path and
        # a warning per call would train everyone to ignore the log.
        log.debug("no identity token for %s: %s", audience, exc)

        # The failure is cached too, briefly.
        #
        # Minting against an absent metadata server costs about three and a half
        # seconds, and without this every call pays it again: a laptop where it
        # never works, and — worse — a production instance during a metadata
        # hiccup, where every internal call would suddenly take seconds instead
        # of failing fast.
        #
        # Short, because a cached failure that outlives the outage turns a blip
        # into a longer one. Thirty seconds is long enough to stop the
        # multiplication and short enough that recovery is nearly immediate.
        _cache[audience] = (None, _now() + _FAILURE_TTL_SECONDS)
        return None

    # Cached well short of the token's real lifetime; the library re-mints
    # cheaply from the metadata server.
    _cache[audience] = (token, _now() + 3600 - _SKEW_SECONDS)
    return token


def auth_headers(audience: str) -> dict[str, str]:
    """Headers to attach to a call to `audience`. Empty when unauthenticated."""
    token = id_token_for(audience)
    return {"Authorization": f"Bearer {token}"} if token else {}


def forget(audience: str | None = None) -> None:
    """Drop cached tokens. Exists so tests do not leak state between cases."""
    if audience is None:
        _cache.clear()
    else:
        _cache.pop(audience, None)
