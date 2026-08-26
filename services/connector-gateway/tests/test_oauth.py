"""Credentials: who can get one, when one is minted, and what a connector sees.

These are the properties that matter if the OAuth path is ever wrong, so they
are asserted rather than assumed:

  - a user who has not connected an account cannot reach one
  - a refused call never mints a token
  - a connector process sees exactly one credential and nothing else
"""

from __future__ import annotations

import httpx
import pytest

from app import mcp_client, oauth, service
from app.enforcement import Ceiling, Grant, Refusal, Usage
from app import catalogue
from app.oauth import (
    ConsentRequired,
    Grant as OAuthGrant,
    InMemoryRefreshTokens,
    OAuthClient,
    access_token_for,
)

CONNECTOR = "google_calendar"
PROVIDER = "google"


def _granted(*, scopes: tuple[str, ...] | None = None, token: str = "rt-1"):
    """A store holding one Google grant covering the calendar connector."""
    covered = scopes if scopes is not None else catalogue.scopes_for(CONNECTOR)
    return InMemoryRefreshTokens(
        tokens={("u", PROVIDER): OAuthGrant(refresh_token=token, scopes=frozenset(covered))}
    )


@pytest.fixture(autouse=True)
def _clean_token_cache():
    oauth.forget()
    yield
    oauth.forget()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(oauth, "secret", lambda name: f"value-of-{name}")
    return OAuthClient(client_id_secret="id", client_secret_secret="secret")


def _transport(handler):
    """Replace httpx's network with a handler, leaving the request path real."""

    class _Client(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(*a, transport=httpx.MockTransport(handler), **kw)

    return _Client


def _grant() -> Grant:
    return Grant(
        connector=CONNECTOR,
        tools=frozenset({"list_events", "create_event"}),
        ceiling=Ceiling.SEND_AUTOMATICALLY,
    )


# --------------------------------------------------------------- token exchange


async def test_a_user_who_never_connected_cannot_get_a_token(client):
    store = InMemoryRefreshTokens(tokens={})
    with pytest.raises(ConsentRequired):
        await access_token_for("someone", CONNECTOR, store=store, client=client)


async def test_a_refresh_token_becomes_an_access_token(client, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert b"grant_type=refresh_token" in request.content
        return httpx.Response(200, json={"access_token": "at-1", "expires_in": 3600})

    monkeypatch.setattr(httpx, "AsyncClient", _transport(handler))
    store = _granted()

    token = await access_token_for("u", CONNECTOR, store=store, client=client, now=0.0)
    assert token == "at-1"


async def test_a_revoked_grant_reads_as_consent_required_not_as_an_outage(
    client, monkeypatch
):
    # Google answers 400 invalid_grant when the user has revoked access. The
    # only fix is for them to connect again, so it must not surface as a
    # connector failure that an engineer would go looking at.
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _transport(lambda _r: httpx.Response(400, json={"error": "invalid_grant"})),
    )
    store = _granted(token="rt-dead")

    with pytest.raises(ConsentRequired):
        await access_token_for("u", CONNECTOR, store=store, client=client)


async def test_a_revoked_grant_does_not_leave_a_usable_token_cached(
    client, monkeypatch
):
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json={"access_token": "at-1", "expires_in": 3600})
        return httpx.Response(400, json={"error": "invalid_grant"})

    monkeypatch.setattr(httpx, "AsyncClient", _transport(handler))
    store = _granted()

    assert await access_token_for("u", CONNECTOR, store=store, client=client, now=0.0) == "at-1"

    # Past the cached token's life, the refresh fails because access was
    # revoked. The previously cached token must not survive that.
    with pytest.raises(ConsentRequired):
        await access_token_for("u", CONNECTOR, store=store, client=client, now=100_000.0)

    oauth.forget()
    with pytest.raises(ConsentRequired):
        await access_token_for("u", CONNECTOR, store=store, client=client, now=100_001.0)


# ------------------------------------------------------------------ the gateway


async def test_a_connector_needing_an_account_is_refused_when_none_is_connected():
    outcome = await service.invoke(
        connector=CONNECTOR,
        tool="list_events",
        arguments={},
        grant=_grant(),
        usage=Usage(0, 0),
        user="u",
        token_store=InMemoryRefreshTokens(tokens={}),
    )
    assert not outcome.ok
    # Answerable — the user connects their calendar — rather than rejected.
    assert outcome.refusal is Refusal.NEEDS_CONSENT


async def test_a_refused_call_never_mints_a_token(monkeypatch):
    minted = {"n": 0}

    async def counting_token(*_a, **_kw):
        minted["n"] += 1
        return "at"

    monkeypatch.setattr(service, "access_token_for", counting_token)

    # Out of scope: the grant does not include delete_event.
    outcome = await service.invoke(
        connector=CONNECTOR,
        tool="delete_event",
        arguments={},
        grant=_grant(),
        usage=Usage(0, 0),
        user="u",
        token_store=_granted(token="rt"),
    )

    assert not outcome.ok
    # Minting is observable at Google. A call the gateway refuses must leave no
    # trace against the user's account.
    assert minted["n"] == 0


async def test_the_connector_receives_the_token_and_the_gateway_keeps_the_secret(
    monkeypatch,
):
    seen: dict = {}

    async def fake_token(*_a, **_kw):
        return "at-live"

    async def fake_call(connector, tool, arguments, credentials=None):
        seen["credentials"] = credentials
        return mcp_client.ToolResult(text='{"events": []}')

    monkeypatch.setattr(service, "access_token_for", fake_token)
    monkeypatch.setattr(service, "call_tool", fake_call)

    outcome = await service.invoke(
        connector=CONNECTOR,
        tool="list_events",
        arguments={},
        grant=_grant(),
        usage=Usage(0, 0),
        user="u",
        token_store=_granted(token="rt"),
    )

    assert outcome.ok
    # The short-lived access token, and only that. The refresh token is the
    # durable credential and must never reach a connector process.
    assert seen["credentials"] == {"GOOGLE_OAUTH_ACCESS_TOKEN": "at-live"}
    assert "rt" not in str(seen["credentials"])


def test_a_connector_process_inherits_no_other_credential(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "should-not-be-visible")
    monkeypatch.setenv("PATH", "/usr/bin")

    env = mcp_client._connector_env({"GOOGLE_OAUTH_ACCESS_TOKEN": "at"})

    assert env["GOOGLE_OAUTH_ACCESS_TOKEN"] == "at"
    assert "RESEND_API_KEY" not in env


async def test_a_grant_that_is_missing_a_scope_is_not_treated_as_connected(client):
    # The user connected their account but unticked a permission on the consent
    # screen. Without checking, the first sign of this is a 403 from Google,
    # which reads as a broken connector rather than a consent they declined.
    store = _granted(scopes=())

    with pytest.raises(ConsentRequired) as caught:
        await access_token_for("u", CONNECTOR, store=store, client=client)
    assert "permission" in str(caught.value)


async def test_a_restricted_tool_needs_more_than_the_base_grant(client):
    # Gmail's base scope is send. Drafting needs gmail.compose, which is
    # restricted — so a user who connected Gmail can send but not draft, and
    # must be told which it is.
    base = catalogue.scopes_for("google_gmail")
    store = InMemoryRefreshTokens(
        tokens={("u", PROVIDER): OAuthGrant(refresh_token="rt", scopes=frozenset(base))}
    )

    with pytest.raises(ConsentRequired):
        await access_token_for("u", "google_gmail", store=store, client=client, tool="create_draft")


def test_the_consent_screen_never_asks_for_a_restricted_scope():
    # Including one makes the whole consent screen fail for anyone outside the
    # test-user list, not just that scope.
    asked = catalogue.consent_scopes("google")
    restricted = {
        s.url
        for c in catalogue.CONNECTORS
        for s in (*c.scopes, *(x for group in c.extra_scopes.values() for x in group))
        if s.tier is catalogue.Tier.RESTRICTED
    }
    assert restricted, "expected at least one restricted scope in the catalogue"
    assert not (set(asked) & restricted)


def test_every_available_connector_declares_scopes_and_a_server():
    from app.mcp_client import SERVERS
    from app.registry import NEEDS_OAUTH, TOOL_ACTIONS

    for connector in catalogue.available():
        assert connector.scopes, f"{connector.id} is available but asks for nothing"

        # Either this gateway serves it over MCP, or it names the service that
        # does. What must never happen is a connector offered to a user with
        # nothing behind it at all.
        assert connector.id in SERVERS or connector.served_by, (
            f"{connector.id} has no MCP server and names no service that uses it"
        )

        if connector.id not in SERVERS:
            # Consented to here, used elsewhere. The severity table and the
            # credential rule govern *calls this gateway makes*, and it makes
            # none for this connector — asserting them would be asserting the
            # absence of a thing rather than the presence of a guard.
            continue

        assert connector.id in TOOL_ACTIONS, f"{connector.id} has no severity table"
        assert connector.id in NEEDS_OAUTH, f"{connector.id} would run without a credential"


def test_coming_soon_connectors_cannot_be_called():
    from app.mcp_client import SERVERS
    from app.registry import TOOL_ACTIONS

    for connector in catalogue.CONNECTORS:
        if connector.status is catalogue.Status.COMING_SOON:
            # Not merely hidden in the UI: absent from the registry, so the
            # gateway refuses the call even if something asks for it directly.
            assert connector.id not in TOOL_ACTIONS
            assert connector.id not in SERVERS
