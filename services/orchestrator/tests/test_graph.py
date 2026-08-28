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


def test_passages_are_in_the_system_context_and_are_not_research():
    class Spy:
        def __init__(self):
            self.system = ""
            self.user = ""

        def structured(self, system, user, schema_hint):
            self.system = system
            self.user = user
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [{"label": "Answer from the file", "done": False}],
                "note": "The indemnity is capped at two million pounds.",
                "citations": [{"chunkId": "c1"}],
            }

    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What does the supply agreement say about indemnity caps",
            passages=[
                Passage(
                    chunk_id="c1",
                    document_id="d1",
                    title="Supply agreement",
                    page=12,
                    text="The indemnity is capped at two million pounds.",
                )
            ],
        ),
        spy,
    )
    assert "Passages retrieved from the user's own documents" in spy.system
    assert "not needsResearch" in spy.system
    assert "The indemnity is capped at two million pounds." in spy.system
    assert "The indemnity is capped at two million pounds." not in spy.user
    assert "What does the supply agreement say" in spy.user


def test_recent_thread_is_in_the_system_context_not_the_user_message():
    class Spy:
        def __init__(self):
            self.system = ""
            self.user = ""

        def structured(self, system, user, schema_hint):
            self.system = system
            self.user = user
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Generate the image",
                        "action": "create_task",
                        "connector": "media",
                        "tool": "generate_image",
                        "arguments": {"prompt": "anime character illustration", "style": ""},
                    }
                ],
                "note": "I will generate that.",
            }

    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Anime character illustration",
            recent_thread=[
                "user: I want to generate an image.",
                "agent: What kind of image would you like?",
            ],
        ),
        spy,
    )
    assert "RECENT CONVERSATION" in spy.system
    assert "I want to generate an image." in spy.system
    assert "I want to generate an image." not in spy.user
    assert spy.user == "Anime character illustration"


def test_a_short_image_follow_up_plans_generate_image_instead_of_clarifying():
    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Anime character illustration",
            recent_thread=[
                "user: I want to generate an image.",
                "agent: What kind of image would you like?",
            ],
        ),
        FakeProvider(),
    )
    assert r.decision in ("plan", "confirm")
    assert r.clarify is None
    image = next(s for s in r.plan if s.tool == "generate_image")
    assert image.connector == "media"


def test_calendar_lookups_do_not_leave_a_list_events_step():
    """A leftover list_events card looks like a button and does nothing."""

    class CalendarPlanner:
        def structured(self, system, user, schema_hint):
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Check Google Calendar for today's meetings",
                        "action": "",
                        "connector": "google_calendar",
                        "tool": "list_events",
                        "arguments": {"limit": 10},
                    }
                ],
                "note": "You had Standup at 10.",
            }

    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Did I have any meeting today?",
            lookups=["whats_on_my_calendar: Standup at 10."],
        ),
        CalendarPlanner(),
    )
    assert r.decision == "plan"
    assert r.clarify is None
    assert all(s.tool != "list_events" for s in r.plan)
    assert r.plan == []
    assert "Standup" in r.note


def test_three_words_without_a_thread_still_hit_the_clarify_gate():
    r = turn("Anime character illustration")
    assert r.decision == "clarify"

