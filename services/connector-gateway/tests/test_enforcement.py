"""The Agent Gateway's enforcement, tested as a control.

Two directions of failure: letting through what should not run, and refusing so
much that the product does nothing. Both are here, and the ordering of refusals
is tested too — telling someone they are rate limited when they never had
permission sends them to fix the wrong thing.
"""

import pytest
from alltheway_policy import Action, Ceiling, Waiver

from app.enforcement import Call, Decision, Grant, Refusal, Usage, authorise

OFFERED = frozenset({"list_events", "create_event", "delete_event", "send_invite"})

FULL = Grant(
    connector="calendar",
    tools=frozenset({"list_events", "create_event", "send_invite"}),
    ceiling=Ceiling.SEND_AFTER_REVIEW,
)
READ_ONLY = Grant(connector="calendar", tools=frozenset({"list_events"}))


# A read by default: `action=None` means "changes nothing".
def call(tool="list_events", action=None, confirmed=False) -> Call:
    return Call(connector="calendar", tool=tool, action=action, confirmed=confirmed)


def run(c: Call, grant=FULL, usage=Usage(), waiver=None) -> Decision:
    return authorise(c, grant=grant, usage=usage, offered_tools=OFFERED, waiver=waiver)


# ----------------------------------------------------------------- scope


def test_a_connector_that_was_never_connected_is_refused():
    assert run(call(), grant=None).refusal is Refusal.NO_GRANT


def test_a_tool_the_connector_does_not_offer_is_refused():
    assert run(call(tool="launch_rocket")).refusal is Refusal.UNKNOWN_TOOL


def test_a_tool_outside_the_grant_is_refused():
    """The grant is an allow-list, not a deny-list.

    A connector that gains a new tool in a future version must not silently gain
    permission to use it.
    """
    assert run(call(tool="delete_event"), grant=READ_ONLY).refusal is Refusal.OUT_OF_SCOPE


def test_a_read_within_scope_is_allowed():
    assert run(call(), grant=READ_ONLY).allowed is True


# ------------------------------------------------- the floor, re-checked here


def test_an_irreversible_call_without_confirmation_is_refused():
    """The property that makes this more than a second copy of the orchestrator.

    Even at the highest ceiling, a side-effecting call arriving without evidence
    that a human agreed does not execute. If the orchestrator were compromised
    or skipped entirely, this still holds.
    """
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=Ceiling.SEND_AUTOMATICALLY)
    decision = run(call(tool="send_invite", action=Action.SEND_EXTERNAL), grant=grant)
    assert decision.allowed is False
    assert decision.refusal is Refusal.NOT_CONFIRMED


def test_the_same_call_with_confirmation_proceeds():
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=Ceiling.SEND_AUTOMATICALLY)
    decision = run(call(tool="send_invite", action=Action.SEND_EXTERNAL, confirmed=True), grant=grant)
    assert decision.allowed is True
    assert any("Confirmed by the user" in line for line in decision.trace)


@pytest.mark.parametrize("ceiling", list(Ceiling))
def test_no_ceiling_lets_an_unconfirmed_irreversible_call_through(ceiling):
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=ceiling)
    assert run(call(tool="send_invite", action=Action.SEND_EXTERNAL), grant=grant).allowed is False


def test_a_valid_waiver_is_what_lets_an_unattended_irreversible_call_run():
    """The one documented way past "a human must say yes".

    An org admin waiver plus the highest ceiling is exactly the mechanism FR-W4
    describes for watchers acting unsupervised. It is attributable and carries a
    justification, which is what makes it different from simply turning the
    check off.
    """
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=Ceiling.SEND_AUTOMATICALLY)
    waiver = Waiver(granted_by="admin@example.com", justification="Approved for the pilot cohort")
    assert run(call(tool="send_invite", action=Action.SEND_EXTERNAL), grant=grant, waiver=waiver).allowed is True

    # Without the waiver, the same call still needs a human.
    assert run(call(tool="send_invite", action=Action.SEND_EXTERNAL), grant=grant).allowed is False


def test_an_invalid_waiver_is_not_a_waiver():
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=Ceiling.SEND_AUTOMATICALLY)
    for bad in (Waiver(granted_by="", justification="Approved for the pilot"),
                Waiver(granted_by="admin@example.com", justification="ok")):
        assert run(call(tool="send_invite", action=Action.SEND_EXTERNAL), grant=grant, waiver=bad).allowed is False


def test_a_read_is_allowed_under_the_most_restrictive_ceiling():
    """Reading a calendar changes nothing, so a draft-only ceiling has no
    opinion about it. Routing reads through the floor refused `list_events`
    under `draft_only` — a ceiling doing something it was never about."""
    locked = Grant(connector="calendar", tools=frozenset({"list_events"}), ceiling=Ceiling.DRAFT_ONLY)
    decision = run(call(), grant=locked)
    assert decision.allowed is True
    assert any("Read-only" in line for line in decision.trace)


def test_a_reversible_call_above_the_ceiling_is_refused():
    grant = Grant(connector="calendar", tools=FULL.tools, ceiling=Ceiling.DRAFT_ONLY)
    decision = run(call(tool="create_event", action=Action.CREATE_TASK), grant=grant)
    assert decision.allowed is False


# ----------------------------------------------------------------- limits


def test_the_rate_limit_refuses_at_the_boundary_not_after():
    at_limit = Usage(last_minute=FULL.per_minute)
    assert run(call(), usage=at_limit).refusal is Refusal.RATE_LIMITED
    just_under = Usage(last_minute=FULL.per_minute - 1)
    assert run(call(), usage=just_under).allowed is True


def test_the_daily_quota_refuses_at_the_boundary():
    assert run(call(), usage=Usage(today=FULL.per_day)).refusal is Refusal.QUOTA_EXHAUSTED
    assert run(call(), usage=Usage(today=FULL.per_day - 1)).allowed is True


def test_limits_are_per_connector_so_one_cannot_starve_another():
    # Usage is passed in per (user, connector); a busy calendar cannot spend the
    # budget that email needs. Expressed here as: the same usage against a
    # different grant is judged against that grant's own limits.
    chatty = Grant(connector="calendar", tools=FULL.tools, per_minute=1000)
    assert run(call(), grant=chatty, usage=Usage(last_minute=100)).allowed is True


def test_permission_is_checked_before_limits():
    """Otherwise the error sends people to fix the wrong thing."""
    decision = run(call(tool="delete_event"), grant=READ_ONLY, usage=Usage(last_minute=10**6))
    assert decision.refusal is Refusal.OUT_OF_SCOPE


def test_a_refused_call_does_not_claim_to_have_spent_budget():
    decision = run(call(tool="delete_event"), grant=READ_ONLY)
    assert not any("this minute" in line for line in decision.trace)


# ----------------------------------------------------------------- explains


def test_every_refusal_says_what_to_do_about_it():
    for decision in (
        run(call(), grant=None),
        run(call(tool="launch_rocket")),
        run(call(tool="delete_event"), grant=READ_ONLY),
        run(call(), usage=Usage(last_minute=10**6)),
        run(call(), usage=Usage(today=10**6)),
    ):
        assert decision.allowed is False
        assert decision.reason, decision.refusal
        assert decision.refusal is not None


def test_an_allowed_call_records_what_it_checked():
    decision = run(call())
    assert decision.allowed is True
    assert any("Scope" in line for line in decision.trace)
    assert any("Limits" in line for line in decision.trace)
