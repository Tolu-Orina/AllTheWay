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

from dataclasses import dataclass, field, replace
from typing import Any

from alltheway_policy import Waiver
from alltheway_screening import screen

from .enforcement import Call, Grant, Refusal, Usage, authorise
from .mcp_client import ConnectorUnavailable, call_tool, list_tools
from .a2a_card import CARD_VERSION
from .audit import record_waiver
from .oauth import ConsentRequired, RefreshTokenStore, access_token_for
from .org_policy import PolicyStore, resolve
from .subscription import FREE, SubscriptionStore
from alltheway_metering import Meter, check

from .registry import NEEDS_OAUTH, UnregisteredTool, action_for


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
    user: str = "",
    token_store: RefreshTokenStore | None = None,
    org: str = "",
    policy_store: PolicyStore | None = None,
    subscriptions: SubscriptionStore | None = None,
) -> Outcome:
    # Every line of this list is attributable: it names the agent and the card
    # version that made the call, so an action in the Transparent Trace can be
    # traced to a specific published contract rather than to "the system".
    trace: list[str] = [f"connector-gateway card {CARD_VERSION} handled this call"]

    # The organisation's policy composes with the user's grant, and only ever
    # downward. An org policy that could raise a ceiling would hand an agent
    # more autonomy than the person it acts for agreed to.
    org_policy = resolve(org, policy_store)
    if grant is not None:
        capped = org_policy.effective_ceiling(grant.ceiling)
        if capped is not grant.ceiling:
            trace.append(
                f"Organisation policy lowered the ceiling from {grant.ceiling} to {capped}"
            )
            grant = replace(grant, ceiling=capped)

    permitted, refusal = org_policy.permits(waiver)
    if not permitted:
        trace.append("Waiver refused by organisation policy")
        return Outcome(False, reason=refusal, refusal=Refusal.ABOVE_CEILING, trace=trace)

    if waiver is not None:
        # Written before the call proceeds, never after. A waiver recorded on
        # success is a record of the calls that worked, which is exactly the
        # set nobody needs.
        record_waiver(
            org=org, user=user, connector=connector, tool=tool, waiver=waiver
        )
        trace.append(
            f"Autonomy floor waived by {waiver.granted_by}, recorded for audit"
        )

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

    # The plan allowance, checked before the call runs and never supplied by
    # the caller. A caller that could state its own tier could grant itself an
    # upgrade, which is the whole reason limits live here beside the autonomy
    # floor rather than in a billing service the acting path can route around.
    subscription = subscriptions.read(user) if subscriptions else FREE
    allowance = check(
        tier=subscription.tier,
        meter=Meter.CONNECTOR_CALLS,
        used=subscription.usage(Meter.CONNECTOR_CALLS),
    )
    if not allowance.allowed:
        trace.append(allowance.summary())
        return Outcome(
            False,
            reason=allowance.summary(),
            refusal=Refusal.PLAN_LIMIT,
            trace=trace,
        )
    if allowance.near_limit:
        # Said while it is still actionable. A user who learns of a limit by
        # being refused cannot do anything about it.
        trace.append(allowance.summary())

    # Credentials are resolved only after the call has been authorised.
    #
    # Order matters: a refused call must not mint a token, both because it is
    # wasted work and because minting is itself observable — a user whose
    # calendar is untouched should not see access to it exchanged.
    credentials: dict[str, str] | None = None
    if connector in NEEDS_OAUTH:
        if token_store is None:
            return Outcome(
                False,
                reason=f"{connector} needs a connected account and none is configured.",
                refusal=Refusal.NEEDS_CONSENT,
                trace=trace,
            )
        try:
            token = await access_token_for(
                user, connector, store=token_store, tool=tool
            )
        except ConsentRequired as exc:
            # Answerable, so it is reported as such: the caller turns this into
            # AUTH_REQUIRED and the user is asked to connect their account,
            # rather than being told the connector is broken.
            trace.append(f"{connector} is not connected for this user")
            return Outcome(
                False, reason=str(exc), refusal=Refusal.NEEDS_CONSENT, trace=trace
            )
        credentials = {"GOOGLE_OAUTH_ACCESS_TOKEN": token}
        trace.append(f"Resolved a short-lived credential for {connector}")

    try:
        result = await call_tool(connector, tool, arguments, credentials)
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
