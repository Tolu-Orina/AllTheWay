"""The gate is the product's core promise, so it is what gets tested."""

from app.graph import run_turn
from app.models import TurnRequest
from app.providers import FakeProvider

provider = FakeProvider()


def turn(message: str, prefs: list[str] | None = None):
    return run_turn(
        TurnRequest(
            session_id="s1", user_id="u1", message=message,
            known_preferences=prefs or [],
        ),
        provider,
    )


def test_vague_request_is_stopped_at_the_gate():
    r = turn("do something")
    assert r.decision == "clarify"
    assert r.clarify is not None
    assert r.plan == []          # nothing planned from an ambiguous request
    assert any("Clarify gate" in t for t in r.trace)


def test_clear_request_produces_a_plan():
    r = turn("Draft a nav wireframe for the desktop dashboard")
    assert r.decision == "plan"
    assert len(r.plan) >= 2
    assert r.clarify is None
    assert all(step.done is False for step in r.plan)


def test_known_preferences_are_recorded_in_the_trace():
    r = turn(
        "Draft a nav wireframe for the desktop dashboard",
        prefs=["Collapse navigation rather than extend it"],
    )
    assert any("learned preference" in t for t in r.trace)


def test_empty_plan_falls_back_to_a_question():
    class EmptyPlanner:
        def structured(self, system, user, schema_hint):
            return {"decision": "plan", "steps": []}

    r = run_turn(
        TurnRequest(session_id="s", user_id="u", message="Draft a nav wireframe please"),
        EmptyPlanner(),
    )
    # An empty checklist is worse than a question.
    assert r.decision == "clarify"
