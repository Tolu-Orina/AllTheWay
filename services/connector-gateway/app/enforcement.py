"""The Agent Gateway: one policy enforcement point in front of every connector.

Manifest: "a single policy-enforcement point in front of the connector layer —
rate limits, scoped permissions, and (for org deployments) org-level policy, in
one place rather than duplicated per connector."

The "one place" is the load-bearing half of that sentence. Enforcement pushed
into each connector is enforcement that is subtly different in each connector,
and the one that is wrong is the one nobody audited.

## This re-checks what the orchestrator already checked

That is not redundancy, it is the point. The confirm gate (FR-V2) runs where the
plan is made; this runs where the effect happens. If the orchestrator were
compromised, buggy, or simply skipped — a watcher calling a connector directly,
a future surface nobody has written yet — an irreversible action still cannot
execute without a confirmation to point at.

A check that only runs on the honest path is documentation, not a control.

## Everything here is pure

No I/O, no clock of its own, no storage. The counters are passed in and the time
is passed in, so every limit can be tested exhaustively at the boundary rather
than by waiting for a minute to pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from alltheway_policy import Action, Ceiling, Waiver, decide


class Refusal(StrEnum):
    """Why a call was refused. Distinct values because they need distinct fixes."""

    NO_GRANT = "no_grant"                 # this user never connected this connector
    OUT_OF_SCOPE = "out_of_scope"         # connected, but not for this tool
    NOT_CONFIRMED = "not_confirmed"       # side-effecting, and nobody said yes
    ABOVE_CEILING = "above_ceiling"       # the autonomy floor refused it
    RATE_LIMITED = "rate_limited"         # too many calls, too fast
    QUOTA_EXHAUSTED = "quota_exhausted"   # too many calls today
    UNKNOWN_TOOL = "unknown_tool"         # the connector does not offer this
    NEEDS_CONSENT = "needs_consent"       # real account, and the user has not connected it
    PLAN_LIMIT = "plan_limit"             # this month's allowance is spent
    # Confirmed as an action, not yet acknowledged as a cost. Separate from
    # NOT_CONFIRMED because the fix is different: the user did say yes, and what
    # they were not told is the price.
    COST_NOT_ACKNOWLEDGED = "cost_not_acknowledged"


@dataclass(frozen=True)
class Grant:
    """What one user has allowed one connector to do.

    FR-W1: a watcher is defined with "a scope of connectors/actions it's
    permitted to use". This is that scope, and it is an allow-list — a tool
    absent from `tools` is refused, so a connector gaining a new tool never
    silently gains permission to use it.
    """

    connector: str
    tools: frozenset[str]
    ceiling: Ceiling = Ceiling.DRAFT_ONLY
    #: Calls per minute, and per day. Both are per user *and* per connector: a
    #: noisy calendar sync must not exhaust the budget that sending email needs.
    per_minute: int = 30
    per_day: int = 500


@dataclass(frozen=True)
class Usage:
    """What this (user, connector) pair has already spent."""

    last_minute: int = 0
    today: int = 0


@dataclass(frozen=True)
class Call:
    connector: str
    tool: str
    #: What this tool would do in the world, or `None` when it only reads.
    #:
    #: Declared by the connector, not by the caller, so a caller cannot relabel
    #: a payment as a draft. `None` is a distinct case rather than a low-severity
    #: action: the autonomy floor governs *effects*, and reading a calendar has
    #: none. Sending a read through it refuses `list_events` under a draft-only
    #: ceiling, which is a ceiling doing something it was never about.
    action: Action | None = None
    #: Evidence that a human agreed, when the action needs it. Carried rather
    #: than assumed: "the orchestrator would have asked" is not evidence.
    confirmed: bool = False


@dataclass(frozen=True)
class Decision:
    allowed: bool
    refusal: Refusal | None = None
    reason: str = ""
    trace: list[str] = field(default_factory=list)


def authorise(
    call: Call,
    *,
    grant: Grant | None,
    usage: Usage,
    offered_tools: frozenset[str],
    waiver: Waiver | None = None,
) -> Decision:
    """Whether this call may execute. Checked in order of cheapness and severity.

    Order matters for the message a user sees: telling someone they are rate
    limited when they never had permission sends them to fix the wrong thing.
    """
    trace: list[str] = []

    if grant is None:
        return Decision(
            False, Refusal.NO_GRANT,
            f"{call.connector} is not connected for this user.", trace,
        )

    if call.tool not in offered_tools:
        # Refused before scope, because "you cannot use a tool that does not
        # exist" is clearer than "that tool is out of scope".
        return Decision(
            False, Refusal.UNKNOWN_TOOL,
            f"{call.connector} does not offer {call.tool}.", trace,
        )

    if call.tool not in grant.tools:
        return Decision(
            False, Refusal.OUT_OF_SCOPE,
            f"{call.tool} is outside what you allowed {call.connector} to do.", trace,
        )
    trace.append(f"Scope: {call.tool} is within the grant for {call.connector}")

    if call.action is None:
        # Reads are governed by scope and limits, not by the autonomy floor.
        trace.append("Read-only: changes nothing, so no autonomy decision applies")
    else:
        # The autonomy floor, re-checked here rather than trusted from upstream.
        verdict = decide(call.action, grant.ceiling, waiver=waiver)
        if not verdict.execute and not call.confirmed:
            return Decision(
                False,
                Refusal.ABOVE_CEILING if call.action is Action.DRAFT else Refusal.NOT_CONFIRMED,
                verdict.reason,
                trace,
            )
        trace.append(
            "Confirmed by the user" if call.confirmed and not verdict.execute
            else f"Autonomy: {verdict.reason}"
        )

    # Limits last: a call that was never going to be allowed should not consume
    # the budget that a legitimate one needs.
    if usage.last_minute >= grant.per_minute:
        return Decision(
            False, Refusal.RATE_LIMITED,
            f"{call.connector} is limited to {grant.per_minute} calls a minute.", trace,
        )

    if usage.today >= grant.per_day:
        return Decision(
            False, Refusal.QUOTA_EXHAUSTED,
            f"{call.connector} has used its {grant.per_day} calls for today.", trace,
        )

    trace.append(
        f"Limits: {usage.last_minute + 1}/{grant.per_minute} this minute, "
        f"{usage.today + 1}/{grant.per_day} today"
    )
    return Decision(True, None, "Within scope, ceiling and limits.", trace)
