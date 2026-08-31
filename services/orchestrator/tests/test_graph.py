"""The gate is the product's core promise, so it is what gets tested."""

from app.graph import run_turn
from app.models import Passage, TurnFile, TurnRequest
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


def test_an_attached_file_is_enough_to_plan():
    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Look at this",
            files=[TurnFile(name="Supply.pdf", mime="application/pdf", file_uri="gs://bucket/u/a/1")],
        ),
        provider,
    )
    assert r.decision == "plan"
    assert r.clarify is None


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


def test_saying_send_an_email_is_still_a_draft():
    r = turn("Send an email to Ana about the Northwind proposal today")
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.tool == "create_draft"
    assert r.decision == "confirm"
    assert "Ana" in step.arguments["to"]
    assert "Northwind" in step.arguments["body"]


def test_a_spoken_email_fills_the_address_and_asks_for_nothing_when_complete():
    r = turn("Send an email to blessing@example.com about tomorrow's QA session for AllTheWay")
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.arguments["to"] == "blessing@example.com"
    assert "QA" in step.arguments["body"]
    assert "email address" not in r.confirm["summary"].lower()


def test_emailing_a_name_asks_for_the_address():
    r = turn("I want to send a message to Blessing")
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.tool == "create_draft"
    assert step.arguments["to"] == "Blessing"
    assert "email address" in r.confirm["summary"]


def test_a_compose_follow_up_keeps_the_recipient_and_fills_the_body():
    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="The message is about a QA session that we have tomorrow for AllTheWay",
            recent_thread=["user: I want to send a message to Blessing"],
        ),
        provider,
    )
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.arguments["to"] == "Blessing"
    assert "QA" in step.arguments["body"]
    assert "email address" in r.confirm["summary"]


def test_a_model_send_email_is_rewritten_on_the_plan_yes_will_replay():
    class SendPlanner:
        def structured(self, system, user, schema_hint):
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Email Ana the proposal",
                        "action": "send_external",
                        "connector": "google_gmail",
                        "tool": "send_email",
                        "arguments": {"to": "ana@example.com", "subject": "Proposal", "body": "See attached."},
                    }
                ],
            }

    r = run_turn(
        TurnRequest(session_id="s1", user_id="u1", message="Send an email to Ana about the proposal today"),
        SendPlanner(),
    )
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.tool == "create_draft"
    assert r.decision == "confirm"
    assert r.confirm["actions"][0]["tool"] == "create_draft"


def test_send_this_draft_keeps_send_email():
    r = turn("Send this draft to Ana today please")
    step = next(s for s in r.plan if s.connector == "google_gmail")
    assert step.tool == "send_email"
    assert r.decision == "confirm"


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


def test_the_clock_is_in_the_system_context_not_the_user_message():
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
                        "label": "Put QA on the calendar",
                        "action": "create_task",
                        "connector": "google_calendar",
                        "tool": "create_event",
                        "arguments": {
                            "title": "QA",
                            "starts_at": "2026-08-31T10:00:00",
                            "time_zone": "Europe/London",
                        },
                    }
                ],
            }

    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="QA tomorrow 10am UK",
            clock="2026-08-30T22:00:00.000Z",
        ),
        spy,
    )
    assert "CLOCK:" in spy.system
    assert "2026-08-30T22:00:00.000Z" in spy.system
    assert "2026-08-30T22:00:00.000Z" not in spy.user
    assert "create_event(title, starts_at, attendees, time_zone)" in spy.system
    assert "Never plan send_email on that first turn" in spy.system
    assert "same draft" in spy.system
    assert spy.user == "QA tomorrow 10am UK"


def test_a_clock_paragraph_is_not_wrapped_again():
    class Spy:
        def __init__(self):
            self.system = ""
            self.user = ""

        def structured(self, system, user, schema_hint):
            self.system = system
            self.user = user
            return {"decision": "plan", "note": "Noted.", "plan": []}

    paragraph = (
        "CLOCK: the current instant is 2026-08-31T12:00:00Z (UTC). "
        "It is Monday 31 August 2026, 13:00, Europe/London (from this device)."
    )
    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Draft a nav wireframe for the desktop dashboard",
            clock=paragraph,
        ),
        spy,
    )
    assert spy.system.count("CLOCK:") == 1
    assert paragraph in spy.system


def test_web_citations_are_urls_that_came_back():
    from app.graph import _web_citations
    from app.research_client import Finding

    finding = Finding(
        answer="Rain later.",
        sources=[
            {"title": "Met Office", "uri": "https://www.metoffice.gov.uk/x"},
            {"title": "invented", "uri": "not-a-url"},
        ],
    )
    citations = _web_citations(finding)
    assert len(citations) == 1
    assert citations[0].kind == "web"
    assert citations[0].url == "https://www.metoffice.gov.uk/x"
    assert citations[0].chunk_id.startswith("web:")


def test_struggles_are_in_the_system_context_not_the_user_message():
    from app.models import Struggle

    class Spy:
        def __init__(self):
            self.system = ""
            self.user = ""

        def structured(self, system, user, schema_hint):
            self.system = system
            self.user = user
            return {"decision": "plan", "needsResearch": False, "steps": [], "note": "ok"}

    spy = Spy()
    run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Explain the indemnity clause again",
            struggles=[Struggle(label="Indemnity", document_id="d1", reasked=2, confidence=0.3)],
        ),
        spy,
    )
    assert "STRUGGLES" in spy.system
    assert "Indemnity" in spy.system
    assert "third explanation" in spy.system
    assert "Indemnity" not in spy.user


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


def test_a_calendar_review_task_is_not_a_confirm_when_lookups_already_answered():
    """create_task + draft_only used to ask 'should I go ahead' to read a calendar."""

    class ReviewPlanner:
        def structured(self, system, user, schema_hint):
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Review upcoming schedule from calendar",
                        "action": "create_task",
                    }
                ],
                "note": "This will create a task — Review upcoming schedule from calendar. Should I go ahead?",
            }

    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What's on my calendar for the next twelve hours?",
            lookups=['whats_on_my_calendar: {"events":[{"title":"Meeting with AWS","startsAt":"12:00"}]}'],
            ceiling="draft_only",
        ),
        ReviewPlanner(),
    )
    assert r.confirm is None
    assert r.plan == []
    assert "Ceiling is draft only" not in (r.note or "")
    assert "AWS" in r.note


def test_a_calendar_summarise_task_is_also_answered_from_lookups():
    class ReviewPlanner:
        def structured(self, system, user, schema_hint):
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Review and summarize the schedule for the next 12 hours",
                        "action": "create_task",
                    }
                ],
                "note": "This will create a task — Review and summarize the schedule for the next 12 hours. Should I go ahead?",
            }

    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What's on my calendar for the next twelve hours?",
            lookups=['whats_on_my_calendar: {"events":[{"title":"Meeting with AWS","startsAt":"12:00"}]}'],
            ceiling="draft_only",
        ),
        ReviewPlanner(),
    )
    assert r.confirm is None
    assert r.plan == []
    assert "AWS" in r.note


def test_a_calendar_write_still_confirms_when_lookups_are_present():
    class WritePlanner:
        def structured(self, system, user, schema_hint):
            return {
                "decision": "plan",
                "needsResearch": False,
                "steps": [
                    {
                        "label": "Add lunch to the calendar",
                        "action": "create_task",
                        "connector": "google_calendar",
                        "tool": "create_event",
                        "arguments": {
                            "title": "Lunch",
                            "starts_at": "2026-08-31T12:00:00+01:00",
                            "time_zone": "Europe/London",
                        },
                    }
                ],
                "note": "This will put lunch on your calendar.",
            }

    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="Add lunch to my calendar at noon",
            lookups=['whats_on_my_calendar: {"events":[{"title":"Standup","startsAt":"10:00"}]}'],
            ceiling="draft_only",
        ),
        WritePlanner(),
    )
    assert r.confirm is not None
    assert any(s.tool == "create_event" for s in r.plan)


def test_fake_provider_answers_a_schedule_read_from_lookups():
    r = run_turn(
        TurnRequest(
            session_id="s1",
            user_id="u1",
            message="What's on my schedule for the next twelve hours?",
            lookups=['whats_on_my_calendar: {"events":[{"title":"Meeting with AWS","startsAt":"12:00"}]}'],
            ceiling="draft_only",
        ),
        FakeProvider(),
    )
    assert r.confirm is None
    assert r.plan == []
    assert "AWS" in r.note
    assert "Ceiling is draft only" not in (r.note or "")


def test_three_words_without_a_thread_still_hit_the_clarify_gate():
    r = turn("Anime character illustration")
    assert r.decision == "clarify"


def test_a_powerpoint_request_names_work_files_slides():
    r = turn("Create a PowerPoint deck about the Q4 launch")
    step = next(s for s in r.plan if s.connector == "work_files")
    assert step.tool == "create_slides"


def test_a_spreadsheet_request_names_work_files_sheet():
    r = turn("Create a spreadsheet of the Q4 launch budget")
    step = next(s for s in r.plan if s.connector == "work_files")
    assert step.tool == "create_spreadsheet"


def test_a_word_document_request_names_work_files_document():
    r = turn("Create a Word document briefing the Q4 launch")
    step = next(s for s in r.plan if s.connector == "work_files")
    assert step.tool == "create_document"


def test_a_markdown_briefing_names_work_files_markdown():
    r = turn("Create a markdown briefing of the Q4 launch")
    step = next(s for s in r.plan if s.connector == "work_files")
    assert step.tool == "create_markdown"


def test_a_pdf_request_names_work_files_pdf():
    r = turn("Create a PDF of the Q4 launch for the board")
    step = next(s for s in r.plan if s.connector == "work_files")
    assert step.tool == "create_pdf"


def test_a_board_deck_with_metrics_plans_chart_and_image_slot():
    r = turn("Create a board deck with metrics and a budget chart")
    step = next(s for s in r.plan if s.tool == "create_slides")
    slides = step.arguments.get("slides") or []
    assert any(isinstance(s, dict) and s.get("layout") == "chart" for s in slides)
    pictured = [
        s
        for s in slides
        if isinstance(s, dict) and (s.get("image") or {}).get("kind") == "generate"
    ]
    assert len(pictured) >= 3

