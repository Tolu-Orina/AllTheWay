"""The confirm gate must fire on the runs where the model forgot to label.

Measured before this existed: both candidate models marked an irreversible step
in only 8 of 12 runs on explicitly risky requests. These are the other 4.
"""

from __future__ import annotations

from alltheway_policy import Action, Ceiling

from app.models import PlanStep
from app.plan_validation import validate
from app.voice import confirmation_for


def _step(label: str, action: str = "") -> PlanStep:
    return PlanStep(label=label, action=action)


# --------------------------------------------------------------- escalation


def test_an_unlabelled_payment_is_caught():
    steps, notes = validate([_step("Pay the outstanding invoice")])
    assert steps[0].action == str(Action.MAKE_PAYMENT)
    assert notes


def test_an_unlabelled_deletion_is_caught():
    steps, _ = validate([_step("Delete the old draft")])
    assert steps[0].action == str(Action.DELETE_DATA)


def test_an_unlabelled_send_is_caught():
    steps, _ = validate([_step("Send the final version to Ana")])
    assert steps[0].action == str(Action.SEND_EXTERNAL)


def test_a_bare_create_task_for_a_briefing_names_work_files():
    from app.plan_validation import attach_work_files

    steps, notes = attach_work_files(
        [PlanStep(label="Create Q4 product launch markdown briefing", action="create_task")],
        "Write a markdown briefing I can keep here for the Q4 product launch.",
    )
    assert steps[0].connector == "work_files"
    assert steps[0].tool == "create_markdown"
    assert notes


def test_a_word_request_is_not_downgraded_to_markdown():
    from app.plan_validation import attach_work_files

    steps, _ = attach_work_files(
        [PlanStep(label="Create the Word document", action="create_task")],
        "Create a Word document briefing the Q4 launch",
    )
    assert steps[0].tool == "create_document"


def test_the_worst_action_in_a_step_wins():
    # "Email the vendor and pay the invoice" is a payment that also sends mail.
    # Judging it as a send would put it below the bar that payments must clear.
    steps, _ = validate([_step("Email the vendor and pay the invoice")])
    assert steps[0].action == str(Action.MAKE_PAYMENT)


def test_understatement_is_raised():
    # The model called a payment a draft. That is the direction that matters.
    steps, notes = validate([_step("Pay the contractor", str(Action.DRAFT))])
    assert steps[0].action == str(Action.MAKE_PAYMENT)
    assert any("Raised" in n for n in notes)


# ------------------------------------------------------------- no downgrade


def test_a_stronger_label_is_left_alone():
    # The words only imply a send; the model said payment. Trusting our own
    # verb list over the model here would *lower* the bar, which is the one
    # thing this must never do.
    steps, notes = validate([_step("Send the payment run", str(Action.MAKE_PAYMENT))])
    assert steps[0].action == str(Action.MAKE_PAYMENT)
    assert notes == []


def test_an_unrecognised_action_is_not_quietly_discarded():
    # models.py promises an unknown action is handled as the most severe case.
    # Dropping it here would undo that promise somewhere nobody would look.
    steps, _ = validate([_step("Do the thing", "obliterate_everything")])
    assert steps[0].action == "obliterate_everything"


def test_a_harmless_step_stays_harmless():
    steps, notes = validate([_step("Summarise the three quotes")])
    assert steps[0].action == ""
    assert notes == []


def test_a_noun_does_not_trigger_a_verb():
    # "the payment was received" reports a fact. Firing on it would train the
    # user to click through confirmations, which is how a gate stops working.
    steps, _ = validate([_step("Note that the payment was received")])
    assert steps[0].action == ""


def test_word_boundaries_are_respected():
    # "postpone" contains "post"; "sender" contains "send".
    steps, _ = validate([_step("Postpone the review with the sender")])
    assert steps[0].action == ""


# ------------------------------------------------- the gate actually fires


def test_the_confirm_gate_fires_on_a_plan_the_model_left_unlabelled():
    # The whole point, end to end: without validation this plan produces no
    # confirmation at all, and the user is never asked before money moves.
    unlabelled = [_step("Review the invoice"), _step("Pay the outstanding invoice")]

    assert (
        confirmation_for(
            unlabelled, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0
        )
        is None
    ), "precondition: an unlabelled plan does not trip the gate"

    validated, _ = validate(unlabelled)
    confirmation = confirmation_for(
        validated, ceiling=Ceiling.SEND_AUTOMATICALLY, confidence=1.0
    )

    assert confirmation is not None
    assert any(a.action is Action.MAKE_PAYMENT for a in confirmation.actions)


def test_a_correction_is_explained_rather_than_applied_silently():
    # Anything an agent decides must be explicable to the person it happened
    # to. A step whose meaning we changed is exactly that.
    _, notes = validate([_step("Delete the archive")])
    assert notes and "Delete the archive" in notes[0]


def test_invites_for_a_new_event_fold_onto_create_event():
    from app.plan_validation import fold_new_event_invites

    steps, notes = fold_new_event_invites(
        [
            PlanStep(
                label="Put QA on the calendar",
                action="create_task",
                connector="google_calendar",
                tool="create_event",
                arguments={"title": "QA", "starts_at": "2026-08-31T10:00:00+01:00"},
            ),
            PlanStep(
                label="Invite Blessing",
                action="send_external",
                connector="google_calendar",
                tool="send_invite",
                arguments={"event_id": "", "email": "blessing.ojubeli@conquerorfoundation.com"},
            ),
        ]
    )
    assert len(steps) == 1
    assert steps[0].tool == "create_event"
    assert "blessing.ojubeli@conquerorfoundation.com" in str(steps[0].arguments.get("attendees"))
    assert steps[0].action == str(Action.SEND_EXTERNAL)
    assert notes


def test_the_first_email_turn_is_rewritten_to_a_draft():
    from app.plan_validation import prefer_gmail_draft

    steps, notes = prefer_gmail_draft(
        [
            PlanStep(
                label="Email Blessing",
                action="send_external",
                connector="google_gmail",
                tool="send_email",
                arguments={"to": "blessing@example.com", "subject": "Work", "body": "cake"},
            )
        ],
        "Send an email to Blessing about work",
    )
    assert steps[0].tool == "create_draft"
    assert steps[0].action == str(Action.DRAFT)
    assert steps[0].arguments["body"] == "cake"
    assert notes


def test_send_this_draft_is_left_as_send_email():
    from app.plan_validation import prefer_gmail_draft

    steps, notes = prefer_gmail_draft(
        [
            PlanStep(
                label="Send the draft to Ana",
                action="send_external",
                connector="google_gmail",
                tool="send_email",
                arguments={"to": "ana@example.com", "subject": "Hi", "body": "Yes"},
            )
        ],
        "Send this draft",
    )
    assert steps[0].tool == "send_email"
    assert notes == []


def test_go_ahead_and_send_an_email_is_still_a_draft():
    from app.plan_validation import prefer_gmail_draft

    steps, notes = prefer_gmail_draft(
        [
            PlanStep(
                label="Email Blessing",
                action="send_external",
                connector="google_gmail",
                tool="send_email",
                arguments={"to": "blessing@example.com", "subject": "Work", "body": ""},
            )
        ],
        "Go ahead and send an email to Blessing",
    )
    assert steps[0].tool == "create_draft"
    assert notes


def test_streamed_send_email_is_aligned_to_the_draft_the_gate_showed():
    from app.plan_validation import align_plan_to_confirmation

    plan = [
        PlanStep(
            label="Email Blessing",
            action="send_external",
            connector="google_gmail",
            tool="send_email",
            arguments={"to": "blessing@example.com", "subject": "Work", "body": ""},
        )
    ]
    aligned = align_plan_to_confirmation(
        plan,
        [
            {
                "label": "Email Blessing",
                "action": "draft",
                "connector": "google_gmail",
                "tool": "create_draft",
                "arguments": {"to": "blessing@example.com", "subject": "Work", "body": "cake"},
            }
        ],
    )
    assert aligned[0].tool == "create_draft"
    assert aligned[0].arguments["body"] == "cake"

