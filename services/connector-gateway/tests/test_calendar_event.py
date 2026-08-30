"""Calendar write arguments: attendees and UK wall time."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "connectors"))

from _calendar_event import emails_from, event_times, zone_id


def test_attendees_accept_a_list_or_a_comma_string():
    assert emails_from("a@x.com, b@x.com") == ["a@x.com", "b@x.com"]
    assert emails_from(["a@x.com", "b@x.com"]) == ["a@x.com", "b@x.com"]
    assert emails_from("not-an-email") == []


def test_uk_is_europe_london():
    assert zone_id("UK") == "Europe/London"
    assert zone_id("Europe/London") == "Europe/London"


def test_a_naive_uk_wall_time_is_not_treated_as_utc():
    start, end = event_times("2026-08-31T10:00:00", "UK")
    assert start["timeZone"] == "Europe/London"
    assert "10:00:00" in start["dateTime"]
    assert "11:00:00" in end["dateTime"]
