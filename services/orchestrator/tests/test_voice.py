"""The voice rules: FR-V2 (confirm before acting) and FR-V4 (do not act on a guess).

These are the two places a spoken turn can hurt someone in a way a typed turn
cannot, so they are tested as safety properties — what must never happen —
rather than as features.
"""

import pytest
from alltheway_policy import Action, Ceiling, Waiver

from app.models import PlanStep
from app.voice import (
    FLOOR,
    IRREVERSIBLE_CERTAINTY,
    READBACK,
    confirmation_for,
    needs_readback,
    transcript_verdict,
)

CEILINGS = list(Ceiling)


def steps(*pairs) -> list[PlanStep]:
    return [PlanStep(label=label, action=action) for label, action in pairs]


SEND = steps(("Email the proposal to Ana", "send_external"))
DRAFT = steps(("Draft the proposal", "draft"))
INERT = [PlanStep(label="Read last year's version")]


# ------------------------------------------------------------------- FR-V4


@pytest.mark.parametrize(
    "confidence,expected",
    [
        (0.0, "reject"), (0.30, "reject"), (FLOOR - 0.01, "reject"),
        (FLOOR, "readback"), (0.70, "readback"), (READBACK - 0.01, "readback"),
        (READBACK, "accept"), (0.95, "accept"), (1.0, "accept"),
    ],
)
def test_confidence_bands(confidence, expected):
    assert transcript_verdict(confidence) == expected


def test_a_poor_transcript_is_never_planned_from():
    # The failure this prevents: acting on a request the user never made.
    assert transcript_verdict(0.2) == "reject"


def test_a_middling_transcript_is_read_back_before_acting():
    assert needs_readback(0.7) is True
    confirmation = confirmation_for(
        SEND, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=0.7,
        transcript="Email the proposal to Ana",
    )
    assert confirmation is not None
    # FR-V4: what we heard is stated as text the user can correct.
    assert 'I heard: "Email the proposal to Ana"' in confirmation.summary


def test_a_confident_transcript_is_not_read_back():
    confirmation = confirmation_for(
        SEND, ceiling=Ceiling.DRAFT_ONLY, confidence=0.99, transcript="Email Ana",
    )
    assert confirmation is not None
    assert "I heard" not in confirmation.summary


# ------------------------------------------------------------------- FR-V2


@pytest.mark.parametrize("ceiling", CEILINGS)
def test_an_irreversible_step_always_stops_for_confirmation(ceiling):
    """The floor, restated for voice.

    No ceiling — not even send_automatically — lets a spoken irreversible
    action through without the user hearing it first.
    """
    confirmation = confirmation_for(SEND, ceiling=ceiling, confidence=1.0)
    assert confirmation is not None, ceiling
    assert confirmation.actions[0].action is Action.SEND_EXTERNAL


def test_a_plan_that_changes_nothing_needs_no_confirmation():
    for plan in (INERT, DRAFT, []):
        assert confirmation_for(plan, ceiling=Ceiling.DRAFT_ONLY, confidence=1.0) is None


def test_a_reversible_step_within_the_ceiling_passes_without_asking():
    plan = steps(("Add a task to follow up", "create_task"))
    assert confirmation_for(plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0) is None


def test_a_reversible_step_above_the_ceiling_still_asks():
    plan = steps(("Add a task to follow up", "create_task"))
    confirmation = confirmation_for(plan, ceiling=Ceiling.DRAFT_ONLY, confidence=1.0)
    assert confirmation is not None
    assert "draft only" in confirmation.actions[0].reason.lower()


def test_an_unrecognised_action_is_treated_as_irreversible():
    """A planner cannot invent its way past the gate.

    If a model returns an action name nobody defined, the safe reading is the
    most severe one — not "unknown, therefore harmless".
    """
    plan = steps(("Do the thing", "launch_missiles"))
    confirmation = confirmation_for(plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0)
    assert confirmation is not None
    assert "irreversible" in confirmation.actions[0].reason.lower()


def test_certainty_is_required_even_when_the_ceiling_permits():
    """Permission to act is not permission to guess.

    A waiver plus the highest ceiling makes this action executable by policy.
    It must still stop, because we are not sure enough about what was said.
    """
    waiver = Waiver(granted_by="admin@example.com", justification="Approved for the pilot cohort")
    plan = steps(("Email the proposal to Ana", "send_external"))

    unsure = confirmation_for(
        plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=IRREVERSIBLE_CERTAINTY - 0.01,
        waiver=waiver,
    )
    assert unsure is not None
    assert "sure I heard you" in unsure.actions[0].reason

    certain = confirmation_for(
        plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0, waiver=waiver,
    )
    # With a valid waiver, the highest ceiling and near-certainty, it may proceed.
    assert certain is None


def test_the_summary_names_what_will_happen_not_how_it_works():
    confirmation = confirmation_for(
        steps(("Pay the Northwind invoice", "make_payment")),
        ceiling=Ceiling.DRAFT_ONLY, confidence=1.0,
    )
    assert confirmation is not None
    assert "move money" in confirmation.summary
    assert confirmation.summary.endswith("Should I go ahead?")
    # Nothing about tasks, policies or ceilings — a person has to act on this
    # after hearing it once.
    assert "ceiling" not in confirmation.summary.lower()


def test_several_actions_are_summarised_together_not_one_by_one():
    plan = steps(
        ("Email Ana", "send_external"),
        ("Delete the old draft", "delete_data"),
        ("Draft the summary", "draft"),
    )
    confirmation = confirmation_for(plan, ceiling=Ceiling.DRAFT_ONLY, confidence=1.0)
    assert confirmation is not None
    assert len(confirmation.actions) == 2  # the draft is not one of them
    assert "2 of these steps change things" in confirmation.summary


def test_confirmation_always_offers_a_way_to_say_no():
    confirmation = confirmation_for(SEND, ceiling=Ceiling.DRAFT_ONLY, confidence=1.0)
    assert confirmation is not None
    assert any("no" in option.lower() for option in confirmation.options)


def test_a_gmail_draft_without_an_address_asks_for_it():
    plan = [
        PlanStep(
            label="Draft an email to Blessing",
            action="draft",
            connector="google_gmail",
            tool="create_draft",
            arguments={"to": "Blessing", "subject": "", "body": ""},
        )
    ]
    confirmation = confirmation_for(plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0)
    assert confirmation is not None
    assert "What's Blessing's email address?" in confirmation.summary
    assert "What should the message say?" in confirmation.summary
    assert "Should I save it?" not in confirmation.summary


def test_a_gmail_draft_with_fields_asks_to_save():
    plan = [
        PlanStep(
            label="Draft an email to Ana",
            action="draft",
            connector="google_gmail",
            tool="create_draft",
            arguments={"to": "ana@example.com", "subject": "Hi", "body": "See you."},
        )
    ]
    confirmation = confirmation_for(plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0)
    assert confirmation is not None
    assert confirmation.actions[0].tool == "create_draft"
    assert confirmation.options[0] == "Save draft"
    assert "Should I save it?" in confirmation.summary
    assert "email address" not in confirmation.summary


def test_a_generic_draft_without_gmail_still_needs_no_confirmation():
    assert confirmation_for(DRAFT, ceiling=Ceiling.DRAFT_ONLY, confidence=1.0) is None


def test_creating_a_calendar_event_always_stops_for_the_form():
    plan = [
        PlanStep(
            label="Lunch with Ana",
            action="create_task",
            connector="google_calendar",
            tool="create_event",
            arguments={"title": "Lunch", "starts_at": "2026-08-31T10:00:00", "time_zone": "Europe/London"},
        )
    ]
    confirmation = confirmation_for(plan, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0)
    assert confirmation is not None
    assert confirmation.actions[0].tool == "create_event"
    assert confirmation.options[0] == "Put on calendar"


# ------------------------------------------------- the gates inside the graph

from app.graph import run_turn  # noqa: E402
from app.models import TurnRequest  # noqa: E402
from app.providers import FakeProvider  # noqa: E402

SENDS = "Email the Northwind proposal to Ana today"
HARMLESS = "Draft a nav wireframe for the desktop dashboard"


def turn(message: str, **kw):
    return run_turn(
        TurnRequest(session_id="s", user_id="u", message=message, **kw), FakeProvider()
    )


def test_a_plan_that_changes_nothing_completes_as_before():
    # The gate must not become a toll booth on every turn.
    assert turn(HARMLESS).decision == "plan"


def test_a_plan_that_sends_stops_for_confirmation():
    result = turn(SENDS)
    assert result.decision == "confirm"
    assert result.confirm is not None
    # The plan travels with it: nobody can agree to something they were not shown.
    assert len(result.plan) >= 2
    assert any(s.action == "send_external" for s in result.plan)


def test_the_confirm_gate_applies_to_typed_turns_too():
    """The rule is about consequences, not about microphones.

    FR-V2 lives under Voice, but the architecture is explicit that voice and
    text run the same graph. A typed instruction that sends an email is exactly
    as irreversible as a spoken one.
    """
    typed = turn(SENDS)
    spoken = turn(SENDS, transcript_confidence=0.97)
    assert typed.decision == spoken.decision == "confirm"


def test_the_highest_ceiling_does_not_skip_the_gate():
    assert turn(SENDS, ceiling="send_automatically").decision == "confirm"


def test_an_unknown_ceiling_is_read_as_the_most_restrictive():
    # A typo in a stored profile must never widen what may happen.
    assert turn(SENDS, ceiling="send_whatever_you_like").decision == "confirm"


def test_an_unusable_transcript_stops_before_the_model_is_called():
    class Exploding:
        def structured(self, system, user, schema_hint):
            raise AssertionError("the planner must not run on an unusable transcript")

    result = run_turn(
        TurnRequest(session_id="s", user_id="u", message="uh mm", transcript_confidence=0.2),
        Exploding(),
    )
    assert result.decision == "clarify"
    assert result.plan == []


def test_a_middling_transcript_is_quoted_back_in_the_summary():
    result = turn(SENDS, transcript_confidence=0.70)
    assert result.decision == "confirm"
    assert f'I heard: "{SENDS}"' in result.confirm["summary"]


def test_a_confident_transcript_is_not_quoted_back():
    result = turn(SENDS, transcript_confidence=0.99)
    assert "I heard" not in result.confirm["summary"]


def test_the_trace_says_why_the_turn_stopped():
    trace = turn(SENDS).trace
    assert any("Confirm gate" in line for line in trace)
    assert any("nothing runs until you say so" in line for line in trace)


def test_streamed_steps_carry_their_action():
    """The regression that made every step look harmless.

    A step object is only complete once the element after it exists, because a
    repaired `{"label":"Email Ana"` is a valid object whose `action` has not
    arrived. Releasing on label alone dropped the action — the one field the
    confirm gate reads.
    """
    from app.graph import run_turn_stream

    events = list(
        run_turn_stream(TurnRequest(session_id="s", user_id="u", message=SENDS), FakeProvider())
    )
    actions = [e.step.action for e in events if e.kind == "step" and e.step]
    assert "send_external" in actions, actions
