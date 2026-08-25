"""What happens when a watcher fires.

    trigger -> screen inbound -+- blocked -> halt, say so, never reach a model
                               +- clean ---> orchestrate -> screen outbound
                                             -> autonomy floor -> act or pause

A watcher is the one surface that reads things strangers wrote. Screening is
therefore the first thing that happens to a trigger and the last thing that
happens to what the model made of it -- not a check somewhere in the middle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from alltheway_policy import Action, Ceiling, Waiver, decide
from alltheway_screening import screen

from .a2a_client import run_turn as a2a_run_turn


@dataclass(frozen=True)
class RunOutcome:
    #: "blocked" is distinct from "failed" on purpose: nothing broke, and the
    #: run did exactly what it should. It is also distinct from
    #: "awaiting_review": there is nothing here for a user to approve.
    state: str            # "done" | "awaiting_review" | "skipped" | "blocked" | "failed"
    detail: str
    reason: str
    plan: list[str]
    #: What happened, in order, so a blocked run can explain itself. Never
    #: carries screened content -- see alltheway_screening on why quoting a
    #: payload turns the block into a second delivery route.
    trace: list[str] = field(default_factory=list)


def _orchestrate(message: str, preferences: list[str]) -> dict:
    """Goes through A2A, so a watcher run uses the same machinery as a session."""
    return a2a_run_turn(message, preferences)


def execute_run(
    *,
    watcher: dict,
    trigger_detail: str,
    preferences: list[str],
    waiver: Waiver | None = None,
) -> RunOutcome:
    """Run one watcher firing through the same graph a live session uses."""

    if not watcher.get("running", False):
        return RunOutcome("skipped", "Watcher is paused.", "Paused by the user.", [])

    trace: list[str] = []

    # Before the model, always. Screening that runs afterwards is not screening:
    # by then the injection has already been read as instructions.
    inbound = screen(trigger_detail, "inbound")
    trace.append(inbound.summary())
    if not inbound.allowed:
        return RunOutcome(
            "blocked",
            "This trigger was not safe to act on.",
            inbound.summary(),
            [],
            trace,
        )

    turn = _orchestrate(trigger_detail, preferences)

    # FR-W3: an ambiguous trigger with nobody in-session pauses for review
    # rather than guessing. A watcher never resolves its own ambiguity.
    if turn.get("decision") == "clarify":
        question = (turn.get("clarify") or {}).get("question", "This needs your input.")
        trace.append("Clarify gate fired with no one in session")
        return RunOutcome(
            "awaiting_review",
            question,
            "Clarify gate fired with no one in session, so the run paused.",
            [],
            trace,
        )

    plan = [step["label"] for step in turn.get("plan", [])]

    # And on the way out. An injection that got past the inbound screen can
    # carry its payload back through what the model produced -- an exfiltration
    # address in a drafted reply, a leaked instruction in a summary.
    outbound = screen(chr(10).join(plan), "outbound")
    trace.append(outbound.summary())
    if not outbound.allowed:
        return RunOutcome(
            "blocked",
            "What this produced was not safe to keep.",
            outbound.summary(),
            [],
            trace,
        )

    action = Action(watcher.get("action", Action.DRAFT))
    ceiling = Ceiling(watcher.get("ceiling", Ceiling.DRAFT_ONLY))
    decision = decide(action, ceiling, waiver=waiver)

    trace.append(decision.reason)

    if not decision.execute:
        return RunOutcome(
            "awaiting_review", plan[0] if plan else "Drafted.", decision.reason, plan, trace
        )

    return RunOutcome("done", plan[0] if plan else "Completed.", decision.reason, plan, trace)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
