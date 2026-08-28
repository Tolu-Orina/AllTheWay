"""Generating media spends real money, so the guards get real tests.

## Why every test here stubs the connector

The first version of this file did not, and it hung: the one test that let the
call through reached `call_tool`, which starts a Veo generation and then polls
it for seven minutes. Nothing was billed only because a connector subprocess is
given an allow-listed environment with no credentials in it — the call died at
`google.auth.default()` rather than at any decision in this file.

That is the wrong reason to be safe. So the connector is stubbed everywhere
below, and *whether it was reached at all* is the assertion, because "the guard
returned a refusal" and "no money was spent" are not the same claim. A refusal
returned after the render has started is not a refusal.
"""

from __future__ import annotations

import pytest
from alltheway_metering import Meter, Tier
from alltheway_policy import Action, Ceiling, Waiver

from app import service
from app.mcp_client import ToolResult
from app.enforcement import Grant, Refusal, Usage
from app.org_policy import InMemoryPolicies, OrgPolicy
from app.registry import action_for, meter_for
from app.service import invoke
from app.subscription import InMemorySubscriptions, Subscription

MEDIA = Grant(
    connector="media",
    tools=frozenset({"generate_image", "draft_video", "poll_draft_video", "render_video"}),
    ceiling=Ceiling.SEND_AUTOMATICALLY,
)


class Spy:
    """Stands in for the connector and records what reached it.

    A generation that never happened leaves no trace anywhere else, so the
    count is the only evidence that the guard bound before the spend rather
    than after it.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def __call__(self, connector, tool, arguments, credentials=None):
        self.calls.append((connector, tool, dict(arguments)))
        # A ToolResult, not a dict: the return value is screened as untrusted
        # inbound content like any other connector's, and a stub that skipped
        # that would be testing a path the real one does not take.
        return ToolResult(text='{"generated": true, "mimeType": "video/mp4"}')

    @property
    def reached(self) -> bool:
        return bool(self.calls)


@pytest.fixture
def connector(monkeypatch):
    spy = Spy()
    monkeypatch.setattr(service, "call_tool", spy)
    return spy


async def _call(tool, arguments=None, subscriptions=None, **kw):
    return await invoke(
        connector="media",
        tool=tool,
        arguments=arguments or {},
        grant=MEDIA,
        usage=Usage(),
        user="u",
        subscriptions=subscriptions,
        **kw,
    )


# ------------------------------------------------------------- severities


def test_a_final_render_is_classified_as_a_payment():
    """Not a metaphor. At roughly fifteen times the draft price, an 8-second
    render costs about six dollars, and MAKE_PAYMENT is the one rung that
    cannot be reached unattended at any ceiling."""
    assert action_for("media", "render_video") is Action.MAKE_PAYMENT


def test_a_draft_and_an_image_sit_below_that():
    assert action_for("media", "draft_video") is Action.CREATE_TASK
    assert action_for("media", "generate_image") is Action.CREATE_TASK
    assert action_for("media", "poll_draft_video") is None


async def test_an_unconfirmed_render_never_reaches_the_model(connector):
    """The autonomy floor's whole point: a ceiling is permission to act, not
    permission to spend six dollars without being asked."""
    outcome = await _call("render_video", {"prompt": "a walkthrough", "seconds": 8})

    assert not outcome.ok
    assert outcome.refusal is Refusal.NOT_CONFIRMED
    assert not connector.reached


async def test_a_confirmed_render_does_reach_it(connector):
    """The complement, so the test above is known to be measuring the
    confirmation rather than something incidental that blocks everything."""
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})})
    outcome = await _call(
        "render_video",
        {"prompt": "x", "seconds": 4},
        subscriptions=paid,
        confirmed=True,
        cost_acknowledged=True,
    )

    assert outcome.ok, outcome.reason
    assert connector.calls == [("media", "render_video", {"prompt": "x", "seconds": 4})]


async def test_an_org_waiver_does_not_buy_an_unattended_render(connector):
    """The waiver path is the one thing that can set the floor aside, so it is
    the one worth asserting against the most expensive tool."""
    store = InMemoryPolicies({"acme": OrgPolicy(org="acme", allow_waivers=True)})
    outcome = await _call(
        "render_video",
        {"prompt": "x", "seconds": 8},
        org="acme",
        policy_store=store,
        waiver=Waiver(granted_by="admin@example.com", justification="Approved for the pilot"),
    )

    # If this ever starts letting the call through, that is a product decision
    # about unattended spend — not a test to quietly update.
    assert not outcome.ok
    assert not connector.reached


# ----------------------------------------------------------------- meters


def test_each_media_tool_charges_its_own_meter():
    assert meter_for("media", "generate_image") == "images"
    assert meter_for("media", "draft_video") == "draft_video_seconds"
    assert meter_for("media", "render_video") == "final_video_seconds"


def test_an_ordinary_connector_call_has_no_special_meter():
    assert meter_for("google_calendar", "list_events") is None


async def test_free_gets_no_video_at_all(connector):
    free = InMemorySubscriptions({"u": Subscription(tier=Tier.FREE, used={})})
    outcome = await _call(
        "draft_video", {"prompt": "x", "seconds": 4}, subscriptions=free, confirmed=True
    )

    assert not outcome.ok
    assert outcome.refusal is Refusal.PLAN_LIMIT
    assert not connector.reached


async def test_the_whole_requested_length_is_checked_before_it_runs(connector):
    """The case a per-call meter would get wrong.

    Two seconds left and eight asked for must be refused *before* the render,
    because there is no partial video to bill for afterwards. A meter that
    charges one unit per call would let this through and go eight seconds over.
    """
    nearly_spent = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.MAX, used={Meter.DRAFT_VIDEO_SECONDS: 298})}
    )
    outcome = await _call(
        "draft_video", {"prompt": "x", "seconds": 8}, subscriptions=nearly_spent, confirmed=True
    )

    assert not outcome.ok
    assert outcome.refusal is Refusal.PLAN_LIMIT
    assert not connector.reached


async def test_a_length_that_fits_is_allowed_to_start(connector):
    room = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.MAX, used={Meter.DRAFT_VIDEO_SECONDS: 100})}
    )
    outcome = await _call(
        "draft_video", {"prompt": "x", "seconds": 8}, subscriptions=room, confirmed=True
    )

    assert outcome.ok
    assert connector.reached


async def test_images_are_metered_separately_from_video(connector):
    """A user out of video seconds can still draw. One meter for both would
    hold the cheap thing hostage to the expensive one."""
    no_video = InMemorySubscriptions(
        {
            "u": Subscription(
                tier=Tier.PLUS,
                used={Meter.DRAFT_VIDEO_SECONDS: 20, Meter.IMAGES: 3},
            )
        }
    )
    outcome = await _call(
        "generate_image", {"prompt": "a wireframe"}, subscriptions=no_video, confirmed=True
    )

    assert outcome.ok
    assert connector.reached


async def test_generated_bytes_are_not_screened_as_inbound_text(connector, monkeypatch):
    """A JPEG as JSON is ~80KB of base64. Model Armor on that fails closed
    or matches SDP on noise, which is how a successful still vanished."""

    def must_not_screen(text, direction):
        raise AssertionError(f"must not screen media bytes as {direction}")

    monkeypatch.setattr(service, "screen", must_not_screen)
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.PLUS, used={})})
    outcome = await _call(
        "generate_image", {"prompt": "a wireframe"}, subscriptions=paid, confirmed=True
    )
    assert outcome.ok, outcome.reason
    assert connector.reached


# ----------------------------------------------------------- brand memory


class Remembering:
    """A visual store that answers for exactly one user."""

    def __init__(self, owner: str, style: str) -> None:
        self.owner, self.style = owner, style

    def style_for(self, user: str) -> str:
        return self.style if user == self.owner else ""


async def test_a_remembered_style_is_applied_to_generation(connector):
    outcome = await _call(
        "generate_image",
        {"prompt": "a wireframe"},
        subscriptions=InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})}),
        confirmed=True,
        visual=Remembering("u", "Muted greens (#2F4F3A)."),
    )

    assert outcome.ok
    assert connector.calls[0][2]["style"] == "Muted greens (#2F4F3A)."


async def test_a_caller_cannot_supply_a_style_of_its_own(connector):
    """The isolation property, in its cheapest possible form.

    If a caller-supplied `style` survived, one tenant could render another's
    brand by naming it — no retrieval, no document, no leak of anything the
    system considers content. Whatever the caller sends is discarded.
    """
    outcome = await _call(
        "generate_image",
        {"prompt": "a wireframe", "style": "Use Acme Corp's palette: #FF0000."},
        subscriptions=InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})}),
        confirmed=True,
        visual=Remembering("someone-else", "Acme red (#FF0000)."),
    )

    assert outcome.ok
    assert connector.calls[0][2]["style"] == ""


async def test_remembering_nothing_sends_an_empty_style(connector):
    """A new user's first image is not shaped by a default someone invented."""
    outcome = await _call(
        "generate_image",
        {"prompt": "a wireframe"},
        subscriptions=InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})}),
        confirmed=True,
    )

    assert outcome.ok
    assert connector.calls[0][2]["style"] == ""


async def test_video_is_left_alone(connector):
    """Only image generation takes a style today. Silently adding an argument a
    tool does not declare is how an MCP call starts failing on validation."""
    outcome = await _call(
        "draft_video",
        {"prompt": "x", "seconds": 4},
        subscriptions=InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})}),
        confirmed=True,
        visual=Remembering("u", "Muted greens."),
    )

    assert outcome.ok
    assert "style" not in connector.calls[0][2]


# ------------------------------------------------------- the second gate


async def test_confirming_the_action_is_not_agreeing_to_the_price(connector):
    """The gap this closes.

    A user says "yes, make the video". That is consent to the action. It is not
    consent to spend fifteen times what a draft costs, because nobody told them
    that is what it costs. So the two are asked separately, and the first does
    not imply the second.
    """
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})})
    outcome = await _call(
        "render_video", {"prompt": "x", "seconds": 8}, subscriptions=paid, confirmed=True
    )

    assert not outcome.ok
    assert outcome.refusal is Refusal.COST_NOT_ACKNOWLEDGED
    assert not connector.reached


async def test_the_price_is_quoted_in_plan_units_and_never_in_money(connector):
    """A user bought an allowance, not a balance. Quoting dollars invites them
    to reason about a number they were never charged, and it is the number that
    changes when pricing does."""
    paid = InMemorySubscriptions(
        {"u": Subscription(tier=Tier.MAX, used={Meter.FINAL_VIDEO_SECONDS: 4})}
    )
    outcome = await _call(
        "render_video", {"prompt": "x", "seconds": 8}, subscriptions=paid, confirmed=True
    )

    assert "final video seconds" in outcome.reason
    # 20 in the Max allowance with 4 already spent leaves 16 — the number the
    # user can check against their own usage page. The permission check
    # deliberately reasons about the last unit of the call, and quoting its
    # figure here would say 9.
    assert "8 of the 16" in outcome.reason
    for money in ("$", "£", "dollar", "pound", "cent"):
        assert money not in outcome.reason.lower()


async def test_acknowledging_the_cost_lets_it_run(connector):
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})})
    outcome = await _call(
        "render_video",
        {"prompt": "x", "seconds": 8},
        subscriptions=paid,
        confirmed=True,
        cost_acknowledged=True,
    )

    assert outcome.ok
    assert connector.reached


async def test_a_cheap_image_is_not_asked_about_twice(connector):
    """Asking twice for everything trains people to click through both, which
    makes the second confirmation worth less than none."""
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})})
    outcome = await _call(
        "generate_image", {"prompt": "a wireframe"}, subscriptions=paid, confirmed=True
    )

    assert outcome.ok
    assert connector.reached


async def test_acknowledging_the_cost_does_not_stand_in_for_confirming(connector):
    """The gates are independent in both directions. A client that sends only
    the cost acknowledgement has not collected consent for the action."""
    paid = InMemorySubscriptions({"u": Subscription(tier=Tier.MAX, used={})})
    outcome = await _call(
        "render_video", {"prompt": "x", "seconds": 8}, subscriptions=paid, cost_acknowledged=True
    )

    assert not outcome.ok
    assert outcome.refusal is Refusal.NOT_CONFIRMED
    assert not connector.reached


def test_polling_a_draft_is_unmetered():
    assert meter_for("media", "poll_draft_video") is None


async def test_polling_a_draft_does_not_need_confirmation(connector):
    """The start already paid. A look at the operation is a read."""
    outcome = await _call("poll_draft_video", {"operation": "ops/x"})

    assert outcome.ok, outcome.reason
    assert connector.calls == [("media", "poll_draft_video", {"operation": "ops/x"})]
