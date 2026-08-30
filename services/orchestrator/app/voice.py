"""Voice-specific rules for a turn.

A spoken turn runs the same graph as a typed one — the architecture is explicit
that there is no fast path around the Clarify Gate or the Plan Panel. Two things
are genuinely different about speech, and only two, so only two live here:

    FR-V4  a transcript can be wrong in a way typed text cannot, so confidence
           has to be part of the decision
    FR-V2  a spoken instruction is easy to give and hard to take back, so a
           side-effecting plan is read back and confirmed before it runs

Everything else about a voice turn is the text turn.

## The confirm gate is the Clarify Gate

Both stop the turn and ask the user for something before anything happens, and
both are `TASK_STATE_INPUT_REQUIRED` on the wire. That is not a coincidence to
hide behind a second mechanism: the protocol already has exactly one state
meaning "I need you before I continue", and this is that state reached for a
different reason. The artifact says which reason.

## Why confidence is not one threshold

A single cutoff treats "draft me a note" and "wire the deposit" as the same
risk. So confidence is checked twice, against different bars:

    before planning     is this good enough to reason about at all?
    before acting       is it good enough to act on, given what it wants to do?

The second bar rises with the severity of the action. Being 85% sure of what
someone said is fine for a draft and not fine for a payment. Permission to act
is not permission to guess.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from alltheway_policy import IRREVERSIBLE, Action, Ceiling, Waiver, decide

from .models import PlanStep

#: Below this the transcript is noise: planning from it would be inventing a
#: request. The turn stops and asks for it again, in text.
FLOOR = 0.55

#: Below this we may plan, but must show what we heard before acting on it.
#: This is FR-V4's "degrade to text" — the transcript becomes something the user
#: reads and corrects rather than something the agent silently trusts.
READBACK = 0.80

#: An irreversible action needs near-certainty about what was actually said.
#: Nothing in the ceiling mechanism lowers this, for the same reason the
#: autonomy floor is not user-adjustable.
IRREVERSIBLE_CERTAINTY = 0.92

Verdict = Literal["reject", "readback", "accept"]

#: What to say when we could not make out the request at all. Deliberately does
#: not guess at the content: repeating a bad transcript back invites the user to
#: say "yes" to something they did not ask for.
UNCLEAR = "I did not catch that clearly enough to act on. Could you say it again, or type it?"


def transcript_verdict(confidence: float) -> Verdict:
    """How much to trust what we think we heard.

    `reject`   too poor to plan from — ask again, in text
    `readback` plan, but show the transcript before acting on it
    `accept`   proceed exactly as a typed turn would
    """
    if confidence < FLOOR:
        return "reject"
    if confidence < READBACK:
        return "readback"
    return "accept"


@dataclass(frozen=True)
class ProposedAction:
    """A plan step that would change something outside this conversation."""

    label: str
    action: Action
    reason: str
    #: The call, when the step names one. Empty when it proposes no call.
    connector: str = ""
    tool: str = ""
    arguments: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Confirmation:
    """What the agent must say aloud, and get a yes to, before proceeding."""

    #: Plain language, meant to be spoken. Short on purpose: a summary nobody
    #: listens to the end of is not a summary.
    summary: str
    actions: list[ProposedAction] = field(default_factory=list)
    #: Offered as spoken options, and rendered as buttons when voice degrades.
    options: list[str] = field(default_factory=lambda: ["Yes, go ahead", "No, stop"])


def _as_action(raw: str) -> Action | None:
    try:
        return Action(raw)
    except ValueError:
        return None


def _verb(action: Action, tool: str = "") -> str:
    if tool == "create_draft":
        return "save a Gmail draft"
    if tool == "create_event":
        return "put something on your calendar"
    return {
        Action.SEND_EXTERNAL: "send something out of your account",
        Action.MAKE_PAYMENT: "move money",
        Action.DELETE_DATA: "delete something",
        Action.CREATE_TASK: "create a task",
        Action.UPDATE_RECORD: "change a record",
        Action.DRAFT: "draft something",
    }.get(action, "change something")


def _summarise(actions: list[ProposedAction], readback: str | None) -> str:
    parts: list[str] = []
    if readback:
        # FR-V4: when we are less than sure, what we heard is stated as text the
        # user can correct, before it is acted on.
        parts.append(f'I heard: "{readback}".')

    if len(actions) == 1:
        parts.append(f"This will {_verb(actions[0].action, actions[0].tool)} — {actions[0].label}.")
    else:
        listed = "; ".join(a.label for a in actions)
        parts.append(f"{len(actions)} of these steps change things: {listed}.")

    parts.append("Should I go ahead?")
    return " ".join(parts)


def needs_readback(confidence: float) -> bool:
    return transcript_verdict(confidence) == "readback"


def _is_compose_review(step: PlanStep) -> bool:
    """Gmail compose and calendar create always stop so the form can appear.

    Other DRAFT steps (a watcher, 'draft the proposal' with no Gmail call) stay
    auto-note. This is a product review, not a weakening of the send floor.
    """
    connector = step.connector or ""
    if step.tool == "create_draft" and connector in ("google_gmail", "gmail", ""):
        return True
    if step.tool == "create_event" and connector in ("google_calendar", "calendar", ""):
        return True
    return False


def _options(actions: list[ProposedAction]) -> list[str]:
    tools = {a.tool for a in actions}
    if tools == {"create_draft"}:
        return ["Save draft", "No, stop"]
    if tools == {"create_event"}:
        return ["Put on calendar", "No, stop"]
    return ["Yes, go ahead", "No, stop"]


def confirmation_for(
    steps: list[PlanStep],
    *,
    ceiling: Ceiling,
    confidence: float,
    transcript: str = "",
    waiver: Waiver | None = None,
) -> Confirmation | None:
    """What must be confirmed before this plan runs, or `None` if nothing.

    The policy decision itself is not made here — it is `alltheway_policy.decide`,
    the same function the watcher runtime uses. Two copies of the autonomy floor
    would drift, and the drift would be silent until something irreversible
    happened on whichever surface was not updated.
    """
    needs: list[ProposedAction] = []

    for step in steps:
        if _is_compose_review(step):
            named = _as_action(step.action)
            if named is None:
                named = Action.DRAFT if step.tool == "create_draft" else Action.CREATE_TASK
            needs.append(
                ProposedAction(
                    label=step.label,
                    action=named,
                    reason="Review the details before this is saved.",
                    connector=step.connector,
                    tool=step.tool,
                    arguments=dict(step.arguments),
                )
            )
            continue

        if not step.action:
            continue  # a step that changes nothing needs no permission

        action = _as_action(step.action)
        if action is None:
            # An action the planner invented is not a licence to act. Unknown is
            # treated as the most severe case, never waved through.
            needs.append(
                ProposedAction(
                    label=step.label,
                    action=Action.SEND_EXTERNAL,
                    reason=f"Unrecognised action {step.action!r}, treated as irreversible.",
                    connector=step.connector,
                    tool=step.tool,
                    arguments=dict(step.arguments),
                )
            )
            continue

        if action is Action.DRAFT:
            continue

        outcome = decide(action, ceiling, waiver=waiver)
        if not outcome.execute:
            needs.append(
                ProposedAction(
                    label=step.label,
                    action=action,
                    reason=outcome.reason,
                    connector=step.connector,
                    tool=step.tool,
                    arguments=dict(step.arguments),
                )
            )
        elif action in IRREVERSIBLE and confidence < IRREVERSIBLE_CERTAINTY:
            needs.append(
                ProposedAction(
                    label=step.label,
                    action=action,
                    reason=(
                        f"Permitted by your ceiling, but I am only "
                        f"{round(confidence * 100)}% sure I heard you correctly."
                    ),
                    connector=step.connector,
                    tool=step.tool,
                    arguments=dict(step.arguments),
                )
            )

    if not needs:
        return None

    readback = transcript.strip() if needs_readback(confidence) and transcript.strip() else None
    return Confirmation(
        summary=_summarise(needs, readback),
        actions=needs,
        options=_options(needs),
    )
