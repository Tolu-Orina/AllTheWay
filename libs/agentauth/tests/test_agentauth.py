"""Attaching identity, and what happens when it cannot be attached."""

import alltheway_agentauth as aa


def setup_function():
    aa.forget()


def test_no_token_available_means_no_header(monkeypatch):
    """The degradation that keeps local development runnable.

    There is no metadata server on a laptop. Refusing to call would defend a
    boundary Cloud Run already defends, at the cost of making the stack
    unrunnable offline.
    """
    monkeypatch.setattr(aa, "id_token_for", lambda audience: None)
    assert aa.auth_headers("https://orchestrator.example") == {}


def test_a_token_becomes_a_bearer_header(monkeypatch):
    monkeypatch.setattr(aa, "id_token_for", lambda audience: "tok123")
    assert aa.auth_headers("https://x.example") == {"Authorization": "Bearer tok123"}


def test_a_failure_to_mint_is_not_an_exception(monkeypatch):
    """A caller must never crash because identity was unavailable."""
    import google.oauth2.id_token as idt

    def explode(*_a, **_k):
        raise RuntimeError("no metadata server")

    monkeypatch.setattr(idt, "fetch_id_token", explode)
    assert aa.id_token_for("https://x.example") is None


def test_tokens_are_cached_per_audience(monkeypatch):
    """One token per target, because Cloud Run checks the audience.

    A token minted for the orchestrator is rejected by the research cell, so a
    single global token would fail in a way that looks like a permissions bug.
    """
    calls = []

    import google.oauth2.id_token as idt
    monkeypatch.setattr(idt, "fetch_id_token", lambda req, aud: (calls.append(aud), f"t-{aud}")[1])

    a = aa.id_token_for("https://a.example")
    b = aa.id_token_for("https://b.example")
    again = aa.id_token_for("https://a.example")

    assert a != b
    assert again == a
    assert calls == ["https://a.example", "https://b.example"]  # the repeat was cached
