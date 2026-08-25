"""One connector call, start to finish.

    authorise -> execute over MCP -> screen what came back

Every connector call goes through this function. That is the whole point of the
Agent Gateway: there is one path to a side effect, so there is one place to
audit, rate limit, and screen — rather than a policy that is subtly different in
each connector, where the one that is wrong is the one nobody looked at.

## Why the response is screened

A calendar invite body, an email subject, a document title — all of it is text a
stranger wrote, arriving in a payload the model will read next. It is exactly
the content the manifest requires screening on, and the connector boundary is
where it enters. Screening the trigger but not the tool response would leave the
larger door open: an attacker who cannot reach your inbox may still be able to
put a line in a shared calendar event.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from alltheway_policy import Waiver
from alltheway_screening import screen

from .enforcement import Call, Grant, Refusal, Usage, authorise
from .mcp_client import ConnectorUnavailable, call_tool, list_tools
from .registry import UnregisteredTool, action_for


@dataclass(frozen=True)
class Outcome:
    ok: bool
    #: What the tool returned, once screened. Empty when the call did not run.
    data: dict[str, Any] = field(default_factory=dict)
    reason: str = ""
    refusal: Refusal | None = None
    trace: list[str] = field(default_factory=list)


async def invoke(
    *,
    connector: str,
    tool: str,
    arguments: dict[str, Any],
    grant: Grant | None,
    usage: Usage,
    confirmed: bool = False,
    waiver: Waiver | None = None,
) -> Outcome:
    trace: list[str] = []

    # What this tool does in the world, from the gateway's own registry rather
    # than from the connector or the caller.
    try:
        action = action_for(connector, tool)
    except UnregisteredTool as exc:
        return Outcome(
            False,
            reason=str(exc),
            refusal=Refusal.UNKNOWN_TOOL,
            trace=trace,
        )

    # Asked, not assumed: a grant naming a tool the connector no longer offers
    # should say so plainly rather than fail somewhere deeper.
    try:
        offered = await list_tools(connector)
    except ConnectorUnavailable as exc:
        return Outcome(False, reason=str(exc), trace=trace)

    decision = authorise(
        Call(connector=connector, tool=tool, action=action, confirmed=confirmed),
        grant=grant,
        usage=usage,
        offered_tools=offered,
        waiver=waiver,
    )
    trace.extend(decision.trace)

    if not decision.allowed:
        return Outcome(False, reason=decision.reason, refusal=decision.refusal, trace=trace)

    try:
        result = await call_tool(connector, tool, arguments)
    except ConnectorUnavailable as exc:
        return Outcome(False, reason=str(exc), trace=trace)

    # What came back is untrusted external content, whatever the connector is.
    verdict = screen(result.text, "inbound")
    trace.append(verdict.summary())
    if not verdict.allowed:
        # The data is dropped, not returned-with-a-warning. A caller handed
        # flagged content alongside a warning will use the content.
        return Outcome(False, reason=verdict.summary(), trace=trace)

    trace.append(f"Called {connector}.{tool}")
    return Outcome(True, data=result.json(), reason=decision.reason, trace=trace)
