"""Plans, entitlements, and what a user has already spent.

## Metered on the two dimensions with real marginal cost

Voice minutes and watcher runs. Not turns, not messages, not "actions" — those
are cheap and metering them would produce a limit that punishes ordinary use
while missing the expensive cases entirely.

A voice minute holds a WebSocket open, pins a Cloud Run instance, and streams
audio through a model. A watcher run is an unattended turn plus whatever
connector calls it makes. Everything else in this product costs a fraction of
either.

## Enforced where the effect happens

The manifest is explicit that limits are a policy concern rather than a billing
afterthought, so the check lives in the Agent Gateway beside the autonomy floor
and the connector scope — not in a payments service that the acting path could
route around.

## This module is the authority; the web app's copy is not

The gateway serves the same numbers to the browser from its own table, because
the browser-facing service has no IAM path here and should not be given one to
read a price list. That split is safe in the direction it can fail: a stale copy
in the UI shows the wrong number, while nothing there decides entitlement.

## A limit is refused before it is exceeded, not after

`check` is consulted before the call runs and reports how much is left. A user
who is told "you have three watcher runs left" can act; one who discovers the
limit by being refused cannot.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum


class Tier(StrEnum):
    FREE = "free"
    PLUS = "plus"
    TEAM = "team"
    #: Exists for one reason: a final Veo render is ~$0.75/second, so a single
    #: 8-second video costs about $6 — a third of a Plus subscription, spent in
    #: one click. That cannot be absorbed into a lower tier, and metering it
    #: there would produce a limit so small it would read as broken.
    MAX = "max"


class Meter(StrEnum):
    """The two dimensions with real marginal cost."""

    VOICE_MINUTES = "voice_minutes"
    WATCHER_RUNS = "watcher_runs"
    #: Not billed. Counted because a connector call is the thing that reaches
    #: someone else's API, and an unbounded one is an abuse surface even when
    #: it is cheap.
    CONNECTOR_CALLS = "connector_calls"

    #: Documents currently stored, not a monthly counter. Delete frees a slot.
    #: Counted at ingest so a sixth upload on Free is refused with a sentence,
    #: not discovered when retrieval starts ignoring the file.
    DOCUMENTS = "documents"

    #: Live meeting insight passes. Each is a grounded reasoning call with web
    #: search over a growing transcript window, so it costs meaningfully more
    #: than a connector call and meaningfully less than a video second.
    #:
    #: The backing-off schedule already holds a ninety-minute meeting to about
    #: ten passes. This bounds the other direction: someone pressing "check now"
    #: repeatedly, which the schedule cannot see.
    MEETING_INSIGHTS = "meeting_insights"

    #: Images, via Nano Banana 2 Lite. Cheap enough to be conversational
    #: ($0.034/1K), so the limit is about abuse rather than cost.
    IMAGES = "images"

    #: Video, split in two because the two ends of the Veo ladder differ by
    #: fifteen times. Draft is ~$0.05/s (veo-3.1-lite); final is ~$0.75/s
    #: (veo-3.1). One meter would price the cheap case as if it were the
    #: expensive one, or the expensive one as if it were free.
    DRAFT_VIDEO_SECONDS = "draft_video_seconds"
    FINAL_VIDEO_SECONDS = "final_video_seconds"


#: Monthly allowances. `None` means unmetered on that dimension.
#:
#: The prices are here for one reason: a limit and its price must be changed in
#: the same diff. Splitting them is how a plan ends up costing more without
#: offering more, or vice versa, with neither change looking wrong on its own.
@dataclass(frozen=True)
class Plan:
    tier: Tier
    label: str
    #: Monthly price in the smallest currency unit, so no float ever touches a
    #: price. 1800 == £18.00.
    price_pence: int
    voice_minutes: int | None
    watcher_runs: int | None
    connector_calls: int | None
    #: Current stored documents, not a monthly spend. None is unmetered.
    documents: int | None
    images: int | None = 0
    draft_video_seconds: int | None = 0
    final_video_seconds: int | None = 0
    #: Live meeting insight passes. Zero on the tiers where meetings are not
    #: the point — the feature is for people running client calls, and
    #: offering a taste of it on Free would be a taste of the expensive half.
    meeting_insights: int | None = 0

    def allowance(self, meter: Meter) -> int | None:
        return {
            Meter.VOICE_MINUTES: self.voice_minutes,
            Meter.WATCHER_RUNS: self.watcher_runs,
            Meter.CONNECTOR_CALLS: self.connector_calls,
            Meter.DOCUMENTS: self.documents,
            Meter.IMAGES: self.images,
            Meter.DRAFT_VIDEO_SECONDS: self.draft_video_seconds,
            Meter.FINAL_VIDEO_SECONDS: self.final_video_seconds,
            Meter.MEETING_INSIGHTS: self.meeting_insights,
        }[meter]


PLANS: dict[Tier, Plan] = {
    Tier.FREE: Plan(
        tier=Tier.FREE,
        label="Free",
        price_pence=0,
        # Enough to genuinely use the product for a week, not enough to run a
        # business on. A free tier that cannot demonstrate the thing it is
        # advertising is a worse acquisition tool than no free tier.
        voice_minutes=30,
        watcher_runs=50,
        connector_calls=200,
        documents=5,
        images=20,
        # Zero, not a small number. A free tier that can spend real money on
        # video is a free tier someone will spend real money with.
        draft_video_seconds=0,
        final_video_seconds=0,
        meeting_insights=0,
    ),
    Tier.PLUS: Plan(
        tier=Tier.PLUS,
        label="Plus",
        # £18/month, as shipped in the marketing page. Confirmed rather than
        # inherited: this was a placeholder in the UI and open decision 4 in
        # the plan, and it is now a decision.
        price_pence=1800,
        voice_minutes=600,
        watcher_runs=1000,
        connector_calls=5000,
        documents=200,
        images=500,
        draft_video_seconds=20,
        # Plus cannot render a final. One 8-second render is $6 against £18.
        final_video_seconds=0,
        meeting_insights=0,
    ),
    Tier.TEAM: Plan(
        tier=Tier.TEAM,
        label="Team",
        # Per seat. Team adds shared connectors, org policy and the audit
        # trail, which are the things an organisation is actually buying.
        price_pence=3200,
        voice_minutes=None,
        watcher_runs=None,
        connector_calls=None,
        documents=None,
        images=2000,
        draft_video_seconds=60,
        final_video_seconds=10,
        meeting_insights=300,
    ),
    Tier.MAX: Plan(
        tier=Tier.MAX,
        label="Max",
        # £60. Priced against the ladder rather than against the competition:
        # 300s of draft at $0.05 plus 20s of final at $0.75 is $30 of cost
        # inside roughly $76 of revenue. Thin on purpose — video is sold at a
        # modest margin, not as a profit centre.
        price_pence=6000,
        voice_minutes=None,
        watcher_runs=None,
        connector_calls=None,
        documents=None,
        images=None,
        draft_video_seconds=300,
        final_video_seconds=20,
        meeting_insights=None,
    ),
}

DEFAULT_TIER = Tier.FREE

#: Stripe statuses that keep a paid entitlement. `past_due` is Smart Retries;
#: `canceled` / `unpaid` / missing fall to Free. `tier` alone is not enough —
#: a webhook that wrote plus and later unpaid must not keep generating.
PAID_STATUSES = frozenset({"active", "trialing", "past_due"})


def effective_tier(doc: dict | None) -> Tier:
    """The plan that actually applies, given a subscriptions/{uid} document.

    Paid only when Stripe says the subscription is still in force *and* the
    stored tier is not free. A missing document, a missing status, or a
    corrupted tier is Free — never the most generous reading.
    """
    if not doc:
        return DEFAULT_TIER
    status = str(doc.get("status") or "").strip().lower()
    if status not in PAID_STATUSES:
        return DEFAULT_TIER
    plan = plan_for(doc.get("tier"))
    if plan.tier is Tier.FREE:
        return DEFAULT_TIER
    return plan.tier


def documents_refused_message(tier: Tier) -> str:
    """Said when ingest is refused, not 'plan limit exceeded'."""
    if tier is Tier.FREE:
        return "Free keeps 5 documents. Delete one, or upgrade to Plus for 200."
    if tier is Tier.PLUS:
        return "Plus keeps 200 documents. Delete one to free a slot."
    return "You have reached this plan's document limit. Delete one to free a slot."


def plan_for(tier: str | Tier | None) -> Plan:
    """The plan for a stored tier value.

    An unrecognised tier resolves to Free rather than raising or to the most
    generous. A corrupted subscription record must not become an upgrade.
    """
    if isinstance(tier, Tier):
        return PLANS[tier]
    try:
        return PLANS[Tier(str(tier or "").strip().lower())]
    except (ValueError, KeyError):
        return PLANS[DEFAULT_TIER]


def period(now: datetime | None = None) -> str:
    """The billing period a usage counter belongs to: `YYYY-MM`, in UTC.

    UTC rather than the user's timezone, so a counter cannot be reset by
    travelling, and so two services never disagree about which month it is.
    """
    moment = now or datetime.now(timezone.utc)
    return f"{moment.year:04d}-{moment.month:02d}"


@dataclass(frozen=True)
class Allowance:
    """What is left on one meter, and whether the next unit is permitted."""

    meter: Meter
    used: int
    limit: int | None
    tier: Tier

    @property
    def unmetered(self) -> bool:
        return self.limit is None

    @property
    def remaining(self) -> int | None:
        if self.limit is None:
            return None
        return max(self.limit - self.used, 0)

    @property
    def allowed(self) -> bool:
        return self.limit is None or self.used < self.limit

    #: Crossed before the user is refused, so the warning arrives while it is
    #: still actionable.
    @property
    def near_limit(self) -> bool:
        if self.limit is None or self.limit == 0:
            return False
        return self.used >= int(self.limit * 0.8)

    def summary(self) -> str:
        if self.unmetered:
            return f"{self.meter.value}: unmetered on {self.tier.value}."
        if not self.allowed:
            return (
                f"You have used all {self.limit} of this month's "
                f"{self.meter.value.replace('_', ' ')} on the {self.tier.value} plan."
            )
        return (
            f"{self.remaining} of {self.limit} "
            f"{self.meter.value.replace('_', ' ')} left this month."
        )


def check(*, tier: str | Tier | None, meter: Meter, used: int) -> Allowance:
    """Whether one more unit is permitted, and how much is left."""
    plan = plan_for(tier)
    return Allowance(meter=meter, used=max(used, 0), limit=plan.allowance(meter), tier=plan.tier)


def as_json() -> dict:
    """The plan table, for anything that needs to display it."""
    return {
        "plans": [
            {
                "tier": str(plan.tier),
                "label": plan.label,
                "pricePence": plan.price_pence,
                # Every meter, derived rather than listed. The three media
                # meters were added in Phase C and this function was not
                # updated, so the plan table it produced was quietly missing a
                # third of itself — and it is the table the interface shows.
                "limits": {str(meter): plan.allowance(meter) for meter in Meter},
            }
            for plan in PLANS.values()
        ]
    }
