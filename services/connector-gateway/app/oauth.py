"""Per-user OAuth for connectors that reach a real account.

The in-memory calendar needed no credential. A real one does, and where that
credential lives decides most of the security properties, so it is worth being
explicit.

## The refresh token lives here, not in the caller

The Agent Gateway is the single enforcement point in front of every connector.
It is therefore also the right place to hold the credential: if a caller passed
a token in with its request, the token would cross the A2A boundary on every
call, appear in request logs, and be replayable by anything that saw one.

Callers send a user identity. This module turns that into a short-lived access
token, at the moment of use.

## Access tokens are never stored

Only the refresh token is persisted. Access tokens are exchanged on demand and
cached in memory for less than their own lifetime, so a database read never
yields anything that can be used against Google, and a rotation takes effect
without a deploy.

## Missing consent is a distinct outcome

`ConsentRequired` is not an error to be logged and swallowed. It maps onto
`TASK_STATE_AUTH_REQUIRED` — the caller is told the user must connect their
calendar, which is an answerable question, rather than "the connector failed",
which is not.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from . import catalogue
from .secrets import SecretUnavailable, get as secret

#: Google's OAuth 2.0 token endpoint. The refresh grant is a plain form POST;
#: no SDK is needed for one request, and one that ships its own HTTP client and
#: retry policy is a larger surface than the thing it replaces.
TOKEN_URL = "https://oauth2.googleapis.com/token"

#: Refreshed this many seconds before expiry. A token that expires in flight
#: fails the call rather than the refresh, which reads as a connector bug.
_SKEW_SECONDS = 120

_EXCHANGE_TIMEOUT_SECONDS = 10.0


class ConsentRequired(RuntimeError):
    """This user has not connected this connector, or the grant was revoked.

    Deliberately separate from ConnectorUnavailable: one is fixed by the user
    clicking connect, the other by an engineer.
    """


@dataclass(frozen=True)
class Grant:
    """What one user has actually authorised, for one provider.

    Scopes are stored alongside the token because Google will happily issue a
    refresh token covering *less* than was asked for — a user can untick a
    scope on the consent screen. Without recording what was granted, the first
    sign that a scope is missing is a 403 from the API, which reads as a
    connector bug rather than as a consent the user declined.
    """

    refresh_token: str
    scopes: frozenset[str]

    def covers(self, required: tuple[str, ...]) -> bool:
        return all(scope in self.scopes for scope in required)


class RefreshTokenStore(Protocol):
    """Where a user's grant for a provider is kept.

    Keyed by *provider*, not connector: Google issues one refresh token per
    (client, user), and a later authorisation supersedes an earlier one. Storing
    one row per connector would mean connecting Gmail silently invalidated the
    token Calendar was using.
    """

    def grant(self, user: str, provider: str) -> Grant | None: ...


@dataclass(frozen=True)
class InMemoryRefreshTokens:
    """For tests and local runs. Never a fallback in a deployed service.

    A store that quietly answers from memory when the real one is unreachable
    is a store that lets a revoked grant keep working.
    """

    tokens: dict[tuple[str, str], Grant]

    def grant(self, user: str, provider: str) -> Grant | None:
        return self.tokens.get((user, provider))


class FirestoreRefreshTokens:
    """The real store.

    One document per (user, provider). A document that does not exist is
    simply "not connected" rather than an error.
    """

    #: Written by the gateway's consent callback, read here. The gateway owns
    #: the browser round-trip because it is the only service the browser talks
    #: to; this service owns the use of what that produced.
    COLLECTION = "connectorGrants"

    def __init__(self, project: str | None = None) -> None:
        # Imported lazily so that neither tests nor the in-memory connector
        # path require a Firestore client or credentials to exist.
        from google.cloud import firestore

        self._db = firestore.Client(project=project or os.environ.get("GOOGLE_CLOUD_PROJECT"))

    @staticmethod
    def document_id(user: str, provider: str) -> str:
        return f"{user}::{provider}"

    def grant(self, user: str, provider: str) -> Grant | None:
        doc = (
            self._db.collection(self.COLLECTION)
            .document(self.document_id(user, provider))
            .get()
        )
        if not doc.exists:
            return None
        token = doc.get("refreshToken")
        if not isinstance(token, str) or not token:
            return None
        scopes = doc.get("scopes")
        return Grant(
            refresh_token=token,
            scopes=frozenset(scopes if isinstance(scopes, list) else []),
        )


@dataclass(frozen=True)
class OAuthClient:
    """Secret Manager *names*, not values.

    Resolved at the moment of use through `secrets.get`, which caches for
    minutes — so rotating the client secret lands without a deploy, and the
    value never sits in this process' configuration.
    """

    client_id_secret: str
    client_secret_secret: str

    @classmethod
    def from_env(cls) -> "OAuthClient":
        return cls(
            client_id_secret=os.environ.get("GOOGLE_OAUTH_CLIENT_ID_SECRET", ""),
            client_secret_secret=os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET_SECRET", ""),
        )

    @property
    def configured(self) -> bool:
        return bool(self.client_id_secret and self.client_secret_secret)


#: (user, provider) -> (access token, expires at). In memory only, and lost on
#: restart, which is correct: a restarted process should re-exchange rather
#: than trust a token it cannot re-verify.
_access_tokens: dict[tuple[str, str], tuple[str, float]] = {}


def forget(user: str | None = None, provider: str | None = None) -> None:
    """Drop cached access tokens. Used by tests, and after a revocation."""
    if user is None or provider is None:
        _access_tokens.clear()
        return
    _access_tokens.pop((user, provider), None)


async def access_token_for(
    user: str,
    connector: str,
    *,
    store: RefreshTokenStore,
    client: OAuthClient | None = None,
    now: float | None = None,
    tool: str | None = None,
) -> str:
    """A usable Google access token for this user, or ConsentRequired.

    Raises rather than returning None, because every caller of this function
    must stop when there is no credential — and a None that gets passed along
    becomes an unauthenticated API call that fails somewhere less clear.
    """
    client = client or OAuthClient.from_env()
    if not client.configured:
        raise ConsentRequired(
            f"{connector} is not configured for OAuth in this environment."
        )

    entry = catalogue.get(connector)
    provider = entry.provider if entry else "google"
    label = entry.label if entry else connector

    clock = time.time() if now is None else now
    key = (user, provider)

    granted = store.grant(user, provider)
    if granted is None:
        raise ConsentRequired(f"Connect your {label} account to use this.")

    # Checked before the cache, not after. A cached token was minted for an
    # earlier grant, and reusing it for a tool the user never authorised would
    # let a narrowed consent go unnoticed until Google refused the call.
    required = catalogue.scopes_for(connector, tool)
    if required and not granted.covers(required):
        missing = [s for s in required if s not in granted.scopes]
        raise ConsentRequired(
            f"{label} needs permission you have not granted yet "
            f"({len(missing)} more). Reconnect it to continue."
        )

    cached = _access_tokens.get(key)
    if cached and cached[1] > clock:
        return cached[0]

    refresh = granted.refresh_token

    try:
        form = {
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": secret(client.client_id_secret),
            "client_secret": secret(client.client_secret_secret),
        }
    except SecretUnavailable as exc:
        # A missing OAuth client is an outage, not a consent problem — but
        # raising anything else here used to crash the A2A handler, which
        # the gateway reported as "I could not reach your calendar".
        raise ConsentRequired(
            f"Could not refresh access to {label} just now. Ask again in a moment."
        ) from exc

    async with httpx.AsyncClient(timeout=_EXCHANGE_TIMEOUT_SECONDS) as http:
        response = await http.post(TOKEN_URL, data=form)

    if response.status_code == 400:
        # Google answers 400 invalid_grant for a revoked or expired refresh
        # token. That is the user's grant being gone, not an outage, and the
        # only fix is for them to connect again.
        forget(user, provider)
        raise ConsentRequired(
            f"Your {label} connection is no longer valid. Connect it again."
        )

    if response.status_code != 200:
        # Deliberately does not include the response body: it is an OAuth
        # error document and this string reaches traces the user can read.
        raise ConsentRequired(
            f"Could not refresh access to {label} (HTTP {response.status_code})."
        )

    payload = response.json()
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise ConsentRequired(f"Google returned no access token for {label}.")

    lifetime = float(payload.get("expires_in", 3600))
    _access_tokens[key] = (token, clock + max(lifetime - _SKEW_SECONDS, 0))
    return token
