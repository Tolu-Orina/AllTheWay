"""Exhaustive: every action against every ceiling.

The point is not coverage for its own sake — it is that the floor must hold in
every combination, including the one a user is most likely to want waived.
"""

import itertools

import pytest

from alltheway_policy import IRREVERSIBLE, Action, Ceiling, Decision, Waiver, decide


def test_every_combination_is_decided():
    for action, ceiling in itertools.product(Action, Ceiling):
        assert isinstance(decide(action, ceiling), Decision)


@pytest.mark.parametrize("action", sorted(IRREVERSIBLE))
@pytest.mark.parametrize("ceiling", list(Ceiling))
def test_irreversible_never_executes_whatever_the_ceiling(action, ceiling):
    # The whole trust story: even "send automatically" does not buy this.
    assert decide(action, ceiling).execute is False


def test_reversible_executes_only_at_the_highest_ceiling():
    assert decide(Action.CREATE_TASK, Ceiling.DRAFT_ONLY).execute is False
    assert decide(Action.CREATE_TASK, Ceiling.SEND_AFTER_REVIEW).execute is False
    assert decide(Action.CREATE_TASK, Ceiling.SEND_AUTOMATICALLY).execute is True


def test_valid_admin_waiver_can_lift_the_floor():
    waiver = Waiver(granted_by="admin@org.com", justification="Contractual SLA auto-ack")
    assert decide(Action.SEND_EXTERNAL, Ceiling.SEND_AUTOMATICALLY, waiver=waiver).execute is True


def test_waiver_does_not_bypass_a_lower_ceiling():
    waiver = Waiver(granted_by="admin@org.com", justification="Contractual SLA auto-ack")
    assert decide(Action.SEND_EXTERNAL, Ceiling.DRAFT_ONLY, waiver=waiver).execute is False


@pytest.mark.parametrize(
    "waiver",
    [
        Waiver(granted_by="", justification="Contractual SLA auto-ack"),
        Waiver(granted_by="admin@org.com", justification="ok"),
        Waiver(granted_by="   ", justification="   "),
    ],
)
def test_malformed_waivers_are_ignored(waiver):
    # An unattributable or unexplained waiver is not a waiver.
    assert decide(Action.SEND_EXTERNAL, Ceiling.SEND_AUTOMATICALLY, waiver=waiver).execute is False


def test_every_decision_states_a_reason():
    for action, ceiling in itertools.product(Action, Ceiling):
        assert decide(action, ceiling).reason.strip()
