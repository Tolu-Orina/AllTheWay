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

    #: The call this step would make, when it makes one.
    #:
    #: The plan used to name only how severe a step was, never what it would
    #: actually do — so a confirmed plan had nothing to replay and "Yes" wrote a
    #: ledger row while the calendar stayed empty. Naming the call here is what
    #: lets the gateway act on the thing the person was shown.
    #:
    #: Empty for a step that changes nothing outside the conversation.
    connector: str = ""
    tool: str = ""
    arguments: dict = Field(default_factory=dict)


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

    #: Passages retrieved from the user's own documents, with citation ids.
    #:
    #: Retrieved by the gateway, not here: only that service can scope a
    #: request to a user, and this one is stateless by design. Arrives the same
    #: way `known_preferences` does, for the same reason.
    #:
    #: **Untrusted.** A passage is text a stranger wrote, screened but not
    #: vouched for. It is labelled as such in the prompt so the model can tell
    #: it apart from what the user actually said.
    passages: list["Passage"] = Field(default_factory=list)

    #: Live reads from the user's connected accounts (calendar, Drive, digest,
    #: meeting notes), fetched by the gateway the same way passages are.
    #:
    #: **Untrusted.** A calendar event title is text someone else wrote.
    #: Labelled in the prompt, never concatenated into the user's message.
    lookups: list[str] = Field(default_factory=list)


class Passage(BaseModel):
    """One retrieved chunk. `chunk_id` is what a citation points at."""

    chunk_id: str = ""
    document_id: str = ""
    title: str = ""
    page: int = 0
    text: str = ""


class Citation(BaseModel):
    """Where a claim came from.

    Returned as a *field*, never inferred from prose. A prompt instruction to
    "always cite" is advisory; a field the code checks is not — and FR-D2 is
    the trust anchor of the whole document feature.

    `text` is the retrieved passage, the same string that was in the prompt.
    The chip opens this; it does not re-query another user.
    """

    chunk_id: str
    document_id: str = ""
    title: str = ""
    page: int = 0
    text: str = ""


class TurnResponse(BaseModel):
    """A question, a plan, or a plan awaiting confirmation.

    This is the Clarify Gate made explicit in the type: a caller cannot
    accidentally act on a plan produced from an ambiguous request. `confirm`
    extends the same idea to FR-V2 -- a plan exists and is shown, but the
    decision says plainly that it may not run yet.
    """

    decision: Literal["clarify", "plan", "confirm"]

    #: What this answer was grounded in. Empty when nothing was retrieved,
    #: which is a different statement from "grounded in nothing in particular".
    citations: list[Citation] = Field(default_factory=list)
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
    #: Citations that survived grounding, carried on `note` / `confirm` so the
    #: gateway can emit them as typed events rather than parsing the trace.
    citations: list[Citation] = Field(default_factory=list)
