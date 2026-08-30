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

Generated media is the exception. The bytes are the model's JPEG or MP4, not
prose, and screening that JSON as inbound text fails closed on size.

"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from alltheway_policy import Action, Waiver
from alltheway_screening import screen

from .enforcement import Call, Grant, Refusal, Usage, authorise
from .mcp_client import ConnectorUnavailable, call_tool, list_tools
from .visual import NoVisualPreferences, VisualStore
from .a2a_card import CARD_VERSION
from .audit import record_waiver
from .oauth import ConsentRequired, RefreshTokenStore, access_token_for
from .secrets import SecretUnavailable
from .org_policy import PolicyStore, resolve
from .subscription import FREE, SubscriptionStore
from alltheway_metering import Meter, check

from .registry import NEEDS_OAUTH, UnregisteredTool, action_for, meter_for


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
    visual: VisualStore | None = None,
    #: The user was shown what this costs in plan units and said yes to
    #: *that*. Separate from `confirmed`, which is only about the action.
    cost_acknowledged: bool = False,
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
    # A poll is a look at a video already started and metered. Charging it as
    # another connector call would spend the monthly budget on waiting.
    skip_call_meter = connector == "media" and tool in {"poll_draft_video", "poll_final_video"}
    if not skip_call_meter and not allowance.allowed:
        trace.append(allowance.summary())
        return Outcome(
            False,
            reason=allowance.summary(),
            refusal=Refusal.PLAN_LIMIT,
            trace=trace,
        )

    # A tool with its own meter is checked against that too. Connector calls
    # cost a fraction of a penny; a final video render costs about six dollars,
    # and one allowance cannot sensibly govern both.
    #
    # The requested size is charged, not one unit: asking for eight seconds of
    # video with two seconds left must be refused *before* it runs, because
    # there is no partial render to bill for afterwards.
    tool_meter = meter_for(connector, tool)
    if tool_meter is not None:
        meter = Meter(tool_meter)
        wanted = int(arguments.get("seconds", 1)) if "video" in tool else 1
        specific = check(
            tier=subscription.tier,
            meter=meter,
            used=subscription.usage(meter) + max(wanted - 1, 0),
        )
        if not specific.allowed:
            trace.append(specific.summary())
            return Outcome(
                False,
                reason=specific.summary(),
                refusal=Refusal.PLAN_LIMIT,
                trace=trace,
            )
        # The second gate, and the reason it is here rather than in the
        # interface: a confirmation the client is trusted to have collected is
        # a confirmation any client can skip. The autonomy floor already asked
        # "do you want this done"; this asks "at this price", which is a
        # different question when a final render costs about fifteen times a
        # draft.
        #
        # Only for MAKE_PAYMENT. Asking twice for a cheap image would train
        # people to click through both, which is how a second confirmation
        # makes a system less safe rather than more.
        if action is Action.MAKE_PAYMENT and not cost_acknowledged:
            # Priced in plan units, never in currency. A user bought an
            # allowance, not a balance, and quoting dollars invites them to
            # reason about a number they were never charged.
            # Measured against what is actually spent, not against the
            # pre-charged figure the permission check uses. `specific` was
            # deliberately asked about the *last* unit of this call, so its
            # remaining count is short by the rest of the call — quoting it
            # would tell someone with sixteen seconds left that they have nine.
            left = check(
                tier=subscription.tier, meter=meter, used=subscription.usage(meter)
            ).remaining
            price = (
                f"This uses about {wanted} of the {left} "
                f"{meter.value.replace('_', ' ')} you have left this month."
                if left is not None
                else f"This uses about {wanted} {meter.value.replace('_', ' ')}."
            )
            trace.append("Cost gate: the price was disclosed and not yet acknowledged")
            return Outcome(
                False,
                reason=price,
                refusal=Refusal.COST_NOT_ACKNOWLEDGED,
                trace=trace,
            )

        if specific.near_limit:
            trace.append(specific.summary())
    if allowance.near_limit:
        # Said while it is still actionable. A user who learns of a limit by
        # being refused cannot do anything about it.
        trace.append(allowance.summary())

    # Credentials are resolved only after the call has been authorised.
    #
    # Order matters: a refused call must not mint a token, both because it is
    # wasted work and because minting is itself observable — a user whose
    # calendar is untouched should not see access to it exchanged.
    # Brand memory, applied at the moment of generation.
    #
    # Overwritten rather than defaulted: a caller that could pass its own
    # `style` could pass anyone's, and a remembered look is user data like any
    # other. Dropping what the caller sent is the point, not a side effect.
    if connector == "media" and tool == "generate_image":
        remembered = (visual or NoVisualPreferences()).style_for(user)
        arguments = {**arguments, "style": remembered}
        if remembered:
            trace.append("Applied the visual preferences remembered for you")

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
        except SecretUnavailable as exc:
            trace.append(f"{connector} could not load its OAuth client")
            return Outcome(False, reason=str(exc), trace=trace)
        credentials = {"GOOGLE_OAUTH_ACCESS_TOKEN": token}
        trace.append(f"Resolved a short-lived credential for {connector}")

    try:
        result = await call_tool(connector, tool, arguments, credentials)
    except ConnectorUnavailable as exc:
        return Outcome(False, reason=str(exc), trace=trace)

    # Generated pixels are the model's JPEG/MP4, not a stranger's prose.
    # Screening that JSON as inbound text fails closed on size or matches SDP
    # on base64 noise, which is how a successful still never left this service.
    if connector == "media" and tool in {
        "generate_image",
        "draft_video",
        "poll_draft_video",
        "render_video",
        "poll_final_video",
    }:
        data = result.json()
        if "error" in data:
            return Outcome(
                False,
                data=data,
                reason=str(data.get("error") or "Could not generate."),
                trace=trace,
            )
        trace.append(f"Called {connector}.{tool}")
        return Outcome(True, data=data, reason=decision.reason, trace=trace)

    # What came back is untrusted external content, whatever the connector is.
    verdict = screen(result.text, "inbound")
    trace.append(verdict.summary())
    if not verdict.allowed:
        # The data is dropped, not returned-with-a-warning. A caller handed
        # flagged content alongside a warning will use the content.
        return Outcome(False, reason=verdict.summary(), trace=trace)

    trace.append(f"Called {connector}.{tool}")
    return Outcome(True, data=result.json(), reason=decision.reason, trace=trace)
