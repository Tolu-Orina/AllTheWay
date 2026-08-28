"""The gate is the product's core promise, so it is what gets tested."""

from app.graph import run_turn
from app.models import Passage, TurnRequest
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


def test_a_schedule_step_names_the_calendar_call():
    r = turn("Schedule lunch with Ana tomorrow please")
    calls = [s for s in r.plan if s.connector]
    assert calls, "a schedule request must name the calendar call, not only a severity"
    assert calls[0].connector == "google_calendar"
    assert calls[0].tool == "create_event"


def test_an_email_step_names_a_gmail_draft():
    r = turn("Email the Northwind proposal to Ana today")
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.tool == "create_draft"


def test_a_document_turn_returns_citations_with_the_retrieved_passage():
    # FR-D2: the citation is the passage that was in the prompt, not a later
    # fetch, and it does not carry a uid.
    passage = Passage(
        chunk_id="c1",
        document_id="d1",
        title="Supply agreement",
        page=12,
        text="The indemnity is capped at two million pounds.",
    )
    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What does the supply agreement say about indemnity caps",
            passages=[passage],
        ),
        provider,
    )
    assert r.decision == "plan"
    assert len(r.citations) == 1
    assert r.citations[0].chunk_id == "c1"
    assert r.citations[0].document_id == "d1"
    assert r.citations[0].text == passage.text


def test_lookups_are_in_the_system_context_not_the_user_message():
    class Spy:
        def __init__(self):
            self.system = ""
            self.user = ""

        def structured(self, system, user, schema_hint):
            self.system = system
            self.user = user
            return {
                "decision": "plan",
                "steps": [{"label": "Answer from the calendar", "done": False}],
                "note": "Standup at 10.",
            }

    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What's on today",
            lookups=["whats_on_my_calendar: Standup at 10."],
        ),
        spy,
    )
    assert "LOOKUPS" in spy.system
    assert "Standup at 10." in spy.system
    assert "Standup at 10." not in spy.user
    assert "What's on today" in spy.user

