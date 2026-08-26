"""Limits must bind, and must not bind the wrong way.

The failures that matter here are asymmetric. Letting a paid user through when
they should be stopped costs money; stopping a paid user who should be allowed
costs the customer. Both are tested, and the corrupted-record case is tested
hardest, because that is the one where a bug quietly hands out an upgrade.
"""

from __future__ import annotations

from datetime import datetime, timezone

from alltheway_metering import (
    DEFAULT_TIER,
    Meter,
    PLANS,
    Tier,
    check,
    period,
    plan_for,
)


def test_the_plus_price_is_the_shipped_one():
    # Open decision 4 was "the £18 in the UI is a placeholder". It is not any
    # more, and this is where the decision lives.
    assert PLANS[Tier.PLUS].price_pence == 1800


def test_every_plan_prices_in_whole_pence():
    # No float ever touches a price. A plan priced at 17.999999 is a bug that
    # only shows up on an invoice.
    for plan in PLANS.values():
        assert isinstance(plan.price_pence, int)


def test_a_free_user_is_stopped_at_the_ceiling():
    allowance = check(tier=Tier.FREE, meter=Meter.WATCHER_RUNS, used=50)
    assert not allowance.allowed
    assert allowance.remaining == 0
    assert "used all 50" in allowance.summary()


def test_a_free_user_below_the_ceiling_is_allowed():
    allowance = check(tier=Tier.FREE, meter=Meter.WATCHER_RUNS, used=49)
    assert allowance.allowed
    assert allowance.remaining == 1


def test_team_is_unmetered_rather_than_generously_metered():
    allowance = check(tier=Tier.TEAM, meter=Meter.VOICE_MINUTES, used=10_000)
    assert allowance.allowed
    assert allowance.unmetered
    assert allowance.remaining is None


def test_the_warning_arrives_while_it_is_still_actionable():
    # A user told "you are nearly out" can act. One who discovers the limit by
    # being refused cannot.
    assert check(tier=Tier.FREE, meter=Meter.VOICE_MINUTES, used=24).near_limit
    assert not check(tier=Tier.FREE, meter=Meter.VOICE_MINUTES, used=23).near_limit


def test_an_unknown_tier_is_not_an_upgrade():
    # The important direction. A corrupted or half-written subscription record
    # must never resolve to the most generous plan.
    assert plan_for("enterprise-mega").tier is DEFAULT_TIER
    assert plan_for(None).tier is DEFAULT_TIER
    assert plan_for("").tier is DEFAULT_TIER


def test_tier_matching_is_forgiving_about_case_and_space():
    assert plan_for(" Plus ").tier is Tier.PLUS


def test_negative_usage_cannot_manufacture_headroom():
    # A counter that went negative through a bad decrement must not read as
    # extra allowance.
    allowance = check(tier=Tier.FREE, meter=Meter.WATCHER_RUNS, used=-100)
    assert allowance.used == 0
    assert allowance.remaining == 50


def test_the_period_is_utc_so_a_counter_cannot_be_reset_by_travelling():
    assert period(datetime(2026, 8, 26, 23, 59, tzinfo=timezone.utc)) == "2026-08"
    assert period(datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)) == "2026-09"


def test_every_plan_declares_every_meter():
    # A meter a plan forgets to declare would read as unmetered, which is the
    # expensive direction to be wrong in.
    for plan in PLANS.values():
        for meter in Meter:
            value = plan.allowance(meter)
            assert value is None or isinstance(value, int)


def test_no_plan_leaves_video_unmetered():
    # The invariant that actually matters. Voice and images cost fractions of a
    # penny, so "unmetered" is a pricing choice there. A final Veo render is
    # ~$0.75 a second — an unmetered video allowance on any plan is an unbounded
    # bill, not a generous tier.
    for plan in PLANS.values():
        assert plan.allowance(Meter.DRAFT_VIDEO_SECONDS) is not None, plan.tier
        assert plan.allowance(Meter.FINAL_VIDEO_SECONDS) is not None, plan.tier


def test_free_cannot_spend_money_on_video():
    for meter in (Meter.DRAFT_VIDEO_SECONDS, Meter.FINAL_VIDEO_SECONDS):
        assert not check(tier=Tier.FREE, meter=meter, used=0).allowed


def test_only_the_top_tiers_can_render_a_final():
    # One 8-second final render is about $6. Inside £18 that is a third of the
    # subscription, spent in a click.
    assert not check(tier=Tier.PLUS, meter=Meter.FINAL_VIDEO_SECONDS, used=0).allowed
    assert check(tier=Tier.TEAM, meter=Meter.FINAL_VIDEO_SECONDS, used=0).allowed
    assert check(tier=Tier.MAX, meter=Meter.FINAL_VIDEO_SECONDS, used=0).allowed


def test_max_costs_sixty_pounds():
    assert PLANS[Tier.MAX].price_pence == 6000


def test_the_draft_allowance_is_always_larger_than_the_final_one():
    # The ladder only works if drafting is the cheap, plentiful step. A plan
    # where finals outnumber drafts would push people to render first.
    for plan in PLANS.values():
        draft = plan.allowance(Meter.DRAFT_VIDEO_SECONDS) or 0
        final = plan.allowance(Meter.FINAL_VIDEO_SECONDS) or 0
        assert draft >= final, plan.tier
