"""Wire types for the orchestrator.

Mirrors @alltheway/contracts on the TypeScript side. Kept deliberately small:
the orchestrator returns a plan and a decision, never prose the gateway has to
interpret.
"""

from typing import Literal

from pydantic import BaseModel, Field


class PlanStep(BaseModel):
    label: str
    done: bool = False
    #: What this step would change outside the conversation, if anything.
    #: Empty means it changes nothing and needs no permission. Values match
    #: `alltheway_policy.Action`; an unrecognised one is treated as the most
    #: severe case rather than ignored, so a planner cannot invent its way past
    #: the confirm gate.
    action: str = ""


class ClarifyQuestion(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)


class TurnRequest(BaseModel):
    session_id: str
    user_id: str
    message: str

    #: How sure the transcriber is, for a spoken turn. `None` means typed, and
    #: typed text is not guessed at — there is nothing to be unsure about.
    transcript_confidence: float | None = None

    #: How much the user has pre-authorised (FR-W4). Defaults to the most
    #: restrictive value, so an unset ceiling can never widen what may happen.
    ceiling: str = "draft_only"
    # What the profile already knows. Passed in rather than fetched so the
    # orchestrator stays stateless and testable.
    known_preferences: list[str] = Field(default_factory=list)


class TurnResponse(BaseModel):
    """A question, a plan, or a plan awaiting confirmation.

    This is the Clarify Gate made explicit in the type: a caller cannot
    accidentally act on a plan produced from an ambiguous request. `confirm`
    extends the same idea to FR-V2 -- a plan exists and is shown, but the
    decision says plainly that it may not run yet.
    """

    decision: Literal["clarify", "plan", "confirm"]
    clarify: ClarifyQuestion | None = None
    #: Set when the plan is ready but must not run until the user agrees
    #: (FR-V2). The plan is still populated -- the user is entitled to see
    #: exactly what they are approving -- but nothing may execute.
    confirm: dict | None = None
    plan: list[PlanStep] = Field(default_factory=list)
    note: str = ""
    trace: list[str] = Field(default_factory=list)


class TurnEvent(BaseModel):
    """One thing becoming known during a turn.

    The stream is a sequence of these, and each is final: a step that has been
    emitted is never retracted. That is what lets a UI append rather than
    reconcile, and it is enforced upstream by `jsonstream.parse_partial`.

    There is deliberately no "decision" event. The verdict is implied by which
    terminal event arrives -- `clarify`, or steps followed by `note` -- because
    announcing a decision early would mean occasionally taking it back when a
    plan turns out to be empty.
    """

    kind: Literal["trace", "step", "clarify", "confirm", "note"]
    text: str = ""
    step: PlanStep | None = None
    clarify: ClarifyQuestion | None = None
    #: The spoken summary and the steps it covers, when the turn stops for
    #: confirmation (FR-V2). Terminal for the turn, like `clarify`.
    confirm: dict | None = None
