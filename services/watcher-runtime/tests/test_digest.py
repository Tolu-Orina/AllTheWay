"""The sweep decides whether to notify, and nothing else.

The failure worth defending against is not a missing digest — it is a second
one. A duplicate notification at 07:01 reads as the product being broken, and
Pub/Sub delivers at least once by design.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.digest import digest_date


def test_the_date_key_is_utc():
    # A key that changes with the traveller's timezone is a key two services
    # disagree about — the same rule the usage period already follows.
    assert digest_date(datetime(2026, 3, 1, 23, 30, tzinfo=timezone.utc)) == "2026-03-01"
    assert digest_date(datetime(2026, 3, 2, 0, 30, tzinfo=timezone.utc)) == "2026-03-02"


def test_the_sweep_is_bounded():
    """The cap exists so that failing at scale is loud rather than silent.

    Without it, a growing user base turns one request into a timeout halfway
    through, with no record of where it stopped and no digests for whoever came
    after that point.
    """
    from app.digest import MAX_USERS_PER_SWEEP

    assert isinstance(MAX_USERS_PER_SWEEP, int)
    assert MAX_USERS_PER_SWEEP > 0
