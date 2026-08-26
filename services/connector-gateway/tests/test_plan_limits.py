"""Plan limits bind where the effect happens, not where the invoice is made."""

from __future__ import annotations

from alltheway_metering import Meter, Tier

from app.enforcement import Ceiling, Grant, Refusal, Usage
from app.service import invoke
from app.subscription import InMemorySubscriptions, Subscription

FULL = Grant(
    connector="calendar",
    tools=frozenset({"list_events", "create_event"}),
    ceiling=Ceiling.SEND_AUTOMATICALLY,
)


async def _call(subscriptions=None, tool="list_events"):
    return await invoke(
        connector="calendar",
        tool=tool,
        arguments={},
        grant=FULL,
        usage=Usage(),
        user="u",
        subscriptions=subscriptions,
    )


async def test_a_spent_allowance_refuses_the_call():
    spent = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.FREE, used={Meter.CONNECTOR_CALLS: 200})}
    )
    outcome = await _call(spent)

    assert not outcome.ok
    assert outcome.refusal is Refusal.PLAN_LIMIT


async def test_an_unspent_allowance_permits_the_call():
    fresh = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.FREE, used={Meter.CONNECTOR_CALLS: 1})}
    )
    assert (await _call(fresh)).ok


async def test_an_unmetered_plan_is_never_refused_on_volume():
    heavy = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.TEAM, used={Meter.CONNECTOR_CALLS: 10_000_000})}
    )
    assert (await _call(heavy)).ok


async def test_the_warning_appears_in_the_trace_before_the_limit_binds():
    # Actionable while there is still something to act on.
    near = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.FREE, used={Meter.CONNECTOR_CALLS: 199})}
    )
    outcome = await _call(near)

    assert outcome.ok
    assert any("left this month" in line for line in outcome.trace)


async def test_a_caller_cannot_state_its_own_tier():
    # invoke() takes a store, never a tier. A caller that could name its plan
    # could grant itself an upgrade, which is the whole reason this check sits
    # beside the autonomy floor rather than in a billing service.
    import inspect

    assert "tier" not in inspect.signature(invoke).parameters
