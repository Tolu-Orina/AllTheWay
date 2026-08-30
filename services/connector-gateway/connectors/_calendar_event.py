"""Shared calendar write arguments.

Both the in-memory connector and the Google one accept the same shape, so a
plan that names `attendees` or `time_zone` does the same thing in tests as it
does against a real account.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_ZONE_ALIASES = {
    "uk": "Europe/London",
    "gb": "Europe/London",
    "britain": "Europe/London",
    "british": "Europe/London",
    "london": "Europe/London",
    "bst": "Europe/London",
    "gmt": "Europe/London",
    "europe/london": "Europe/London",
}


def emails_from(attendees: object) -> list[str]:
    """One or more invitees, as the planner tends to pass them.

    A list, a comma/semicolon string, or a JSON list encoded as a string.
    Empty and junk are dropped rather than sent to Calendar as a fake address.
    """
    if attendees is None:
        return []
    if isinstance(attendees, list):
        raw = attendees
    elif isinstance(attendees, str):
        text = attendees.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                import json

                parsed = json.loads(text)
                if isinstance(parsed, list):
                    raw = parsed
                else:
                    raw = [text]
            except ValueError:
                raw = [p for p in text.replace(";", ",").split(",")]
        else:
            raw = [p for p in text.replace(";", ",").split(",")]
    else:
        return []

    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        email = str(item).strip()
        if not email or "@" not in email or " " in email:
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(email)
    return out


def zone_id(raw: str) -> str:
    name = raw.strip()
    if not name:
        return ""
    aliased = _ZONE_ALIASES.get(name.lower())
    candidate = aliased or name
    try:
        ZoneInfo(candidate)
    except ZoneInfoNotFoundError:
        return ""
    return candidate


def _parse_starts(starts_at: str) -> datetime | None:
    try:
        return datetime.fromisoformat(starts_at.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def event_times(starts_at: str, time_zone: str = "") -> tuple[dict[str, str], dict[str, str]]:
    """Google Calendar `start` / `end` objects. End is one hour later.

    A named zone (UK, Europe/London) is preferred over a naive wall time that
    Calendar would otherwise read as UTC — which is how 10:00 UK became 11:00
    in summer, or failed the API for missing an offset.
    """
    zone = zone_id(time_zone)
    parsed = _parse_starts(starts_at)
    if parsed is None:
        body = {"dateTime": starts_at}
        if zone:
            body["timeZone"] = zone
        return body, dict(body)

    if parsed.tzinfo is None and zone:
        start_local = parsed.replace(tzinfo=ZoneInfo(zone))
        end_local = start_local + timedelta(hours=1)
        return (
            {"dateTime": start_local.isoformat(timespec="seconds"), "timeZone": zone},
            {"dateTime": end_local.isoformat(timespec="seconds"), "timeZone": zone},
        )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    ended = parsed + timedelta(hours=1)
    start_body: dict[str, str] = {"dateTime": parsed.isoformat().replace("+00:00", "Z")}
    end_body: dict[str, str] = {"dateTime": ended.isoformat().replace("+00:00", "Z")}
    if zone:
        start_body["timeZone"] = zone
        end_body["timeZone"] = zone
    return start_body, end_body


def attendee_payload(attendees: object) -> list[dict[str, str]]:
    return [{"email": email} for email in emails_from(attendees)]
