"""What the catalogue must never do.

The registry's value is entirely in whether it tells the truth about trust. A
catalogue that hides a bad card, or that presents an unverifiable one as
ordinary, is worse than no catalogue — it launders the problem into something
that looks authoritative.
"""

from __future__ import annotations

import httpx
import pytest
from alltheway_agentcards import generate_key, load_private_key, sign

from app import catalogue
from app.catalogue import describe, describe_one
from app.roster import Entry

KID = "alltheway-test"


def _card(url: str = "https://orchestrator-prod.run.app") -> dict:
    return {
        "name": "orchestrator",
        "description": "Plans a turn.",
        "version": "1.1.0",
        "supportedInterfaces": [{"url": url}],
        "skills": [{"id": "plan_session", "name": "Plan", "description": "Plans."}],
    }


@pytest.fixture
def keys(monkeypatch):
    private_pem, public_pem = generate_key()
    monkeypatch.setenv("AGENT_CARD_PUBLIC_KEY", public_pem)
    monkeypatch.setenv("AGENT_CARD_KEY_ID", KID)
    return load_private_key(private_pem)


@pytest.fixture(autouse=True)
def one_agent(monkeypatch):
    """A roster of exactly one, so a test asserts about a known row."""
    entry = Entry(
        id="orchestrator",
        owner="core",
        purpose="Plans a turn.",
        url_env="ORCHESTRATOR_URL",
    )
    monkeypatch.setenv("ORCHESTRATOR_URL", "https://orchestrator-prod.run.app")
    monkeypatch.setattr(catalogue, "configured", lambda: (entry,))
    return entry


def _serve(payload, status: int = 200):
    """Replace the network, leaving the fetch and parse paths real."""

    def handler(_request: httpx.Request) -> httpx.Response:
        if isinstance(payload, dict):
            return httpx.Response(status, json=payload)
        return httpx.Response(status, text=str(payload))

    class _Client(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(*a, transport=httpx.MockTransport(handler), **kw)

    return _Client


async def test_a_signed_card_is_reported_as_trusted(keys, monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _serve(sign(_card(), private_key=keys, kid=KID)))

    result = await describe()
    agent = result["agents"][0]

    assert agent["reachable"]
    assert agent["signature"]["trusted"]
    assert agent["version"] == "1.1.0"
    assert result["summary"] == {"total": 1, "reachable": 1, "trusted": 1}


async def test_an_unsigned_card_is_listed_but_not_trusted(keys, monkeypatch):
    # Listed, because hiding it would hide the problem. Untrusted, because
    # "we could not check" must never read as "it is fine".
    monkeypatch.setattr(httpx, "AsyncClient", _serve(_card()))

    agent = (await describe())["agents"][0]

    assert agent["reachable"]
    assert not agent["signature"]["trusted"]
    assert agent["signature"]["state"] == "unsigned"


async def test_a_tampered_card_is_reported_as_invalid(keys, monkeypatch):
    # The attack card signing exists to stop: an A2A client talks to the URL
    # the card advertises, so rewriting it redirects the agent's traffic.
    signed = sign(_card(), private_key=keys, kid=KID)
    signed["supportedInterfaces"] = [{"url": "https://evil.example"}]
    monkeypatch.setattr(httpx, "AsyncClient", _serve(signed))

    agent = (await describe())["agents"][0]

    assert agent["signature"]["state"] == "invalid"
    assert not agent["signature"]["trusted"]
    # And the mismatch is visible without understanding signatures at all.
    assert agent["advertisedUrl"] == "https://evil.example"
    assert agent["url"] != agent["advertisedUrl"]


async def test_a_card_signed_by_an_unknown_key_is_not_trusted(monkeypatch):
    other_private, _ = generate_key()
    monkeypatch.setenv("AGENT_CARD_PUBLIC_KEY", generate_key()[1])
    monkeypatch.setenv("AGENT_CARD_KEY_ID", KID)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _serve(sign(_card(), private_key=load_private_key(other_private), kid=KID)),
    )

    assert not (await describe())["agents"][0]["signature"]["trusted"]


async def test_an_unreachable_agent_degrades_its_own_row_only(keys, monkeypatch):
    def handler(_request):
        raise httpx.ConnectError("refused")

    class _Client(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(*a, transport=httpx.MockTransport(handler), **kw)

    monkeypatch.setattr(httpx, "AsyncClient", _Client)

    result = await describe()
    agent = result["agents"][0]

    # A catalogue that fails entirely because one member is down tells you less
    # than one that says which member is down.
    assert not agent["reachable"]
    assert agent["error"]
    assert result["summary"]["reachable"] == 0


async def test_a_non_200_is_not_treated_as_a_card(keys, monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _serve({"error": "nope"}, status=503))

    agent = (await describe())["agents"][0]
    assert not agent["reachable"]
    assert "503" in agent["error"]


async def test_a_non_json_response_is_not_treated_as_a_card(keys, monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _serve("<html>login</html>"))

    agent = (await describe())["agents"][0]
    assert not agent["reachable"]
    assert agent["signature"] is None


async def test_an_agent_with_no_url_is_reported_rather_than_hidden(keys, monkeypatch):
    monkeypatch.delenv("ORCHESTRATOR_URL", raising=False)

    agent = (await describe())["agents"][0]
    # Silently dropping it would make a misconfiguration look like an agent
    # that was never meant to exist.
    assert not agent["reachable"]
    assert "ORCHESTRATOR_URL" in agent["error"]


async def test_an_unknown_agent_is_not_invented():
    assert await describe_one("does-not-exist") is None


def test_the_registry_imports_without_protobuf():
    """A verifier must not need the A2A SDK.

    This service reads cards and checks signatures; it never serves one. Its
    first build failed with `No module named google.protobuf` because
    `alltheway_agentcards.a2a` imported protobuf at module scope for the
    *signing* path — a dependency the registry has no reason to carry.

    Simulated by hiding the module and re-importing, which is the only way to
    catch this outside an image build.
    """
    import builtins
    import importlib

    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name.startswith("google.protobuf"):
            raise ModuleNotFoundError("No module named 'google.protobuf'")
        return real_import(name, *args, **kwargs)

    builtins.__import__ = blocked
    try:
        for module in ("alltheway_agentcards.a2a", "app.catalogue"):
            importlib.reload(importlib.import_module(module))
    finally:
        builtins.__import__ = real_import
        # Leave the modules as the rest of the suite expects them.
        importlib.reload(importlib.import_module("alltheway_agentcards.a2a"))
        importlib.reload(importlib.import_module("app.catalogue"))
