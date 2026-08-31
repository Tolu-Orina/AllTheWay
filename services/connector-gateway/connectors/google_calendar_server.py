"""Google Calendar, as a real MCP server.

The sibling `calendar_server.py` keeps a dict in memory and proves the gateway's
half: discovery, refusal, execution, screening. This one does the same four
things against a real account, so the parts that only appear when a network and
another company's API are involved — auth, partial failure, pagination,
someone else's error shapes — are exercised rather than imagined.

## The access token arrives in the environment, per call

The Agent Gateway spawns this process for one call and passes exactly one
credential in. It is not read from a config file, not fetched by this process,
and not long-lived: it is a short-lived access token the gateway exchanged a
moment ago from a refresh token it holds.

That shape is deliberate. This module never sees the refresh token, so a bug
here cannot leak the durable credential, and a connector that is compromised
loses access when the access token expires rather than permanently.

## Severity is still not declared here

What each tool does in the world lives in the Agent Gateway's registry. The
docstrings below say what each does; the registry is what enforcement reads.

## Errors are returned, not raised into the transport

Google's failure modes are ordinary: a deleted event, an account without
calendar access, a rate limit. Each comes back as JSON the gateway can screen
and the caller can act on, rather than as an MCP transport error that reads as
"the connector is broken".
"""

from __future__ import annotations

import json
import os
from typing import Any

from mcp.server.fastmcp import FastMCP

from _google import capped, fail as _fail_json, message_from as _message_from, ok, request
from _calendar_event import attendee_payload, emails_from, event_times

mcp = FastMCP("alltheway-google-calendar")

API = "https://www.googleapis.com/calendar/v3"

#: Which calendar. "primary" is the signed-in user's own, which is the only one
#: the granted scope reliably covers.
CALENDAR_ID = "primary"


def _request(method: str, path: str, **kwargs):
    """Shared with every other Google connector, so the credential guard is
    one implementation rather than four that can drift apart."""
    return request(method, f"{API}{path}", **kwargs)


@mcp.tool()
def list_events(limit: int = 10, time_min: str = "") -> str:
    """Events on the user's primary calendar. Reads only.

    `time_min` is RFC 3339. Empty means upcoming from now — the default for
    "what's next". A start-of-day value is what "did I have any meetings
    today" needs, because now would skip everything that already happened.
    """
    capped_limit = capped(limit)
    window = time_min.strip() or _now_rfc3339()

    status, payload = _request(
        "GET",
        f"/calendars/{CALENDAR_ID}/events",
        params={
            "maxResults": capped_limit,
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": window,
        },
    )
    if status != 200:
        return _fail_json(_message_from(payload, "Could not read the calendar."), status=status)

    events = [
        {
            "id": item.get("id"),
            "title": item.get("summary", "(no title)"),
            "startsAt": (item.get("start") or {}).get("dateTime")
            or (item.get("start") or {}).get("date"),
            "hangoutLink": item.get("hangoutLink") or "",
        }
        for item in payload.get("items", [])
        if isinstance(item, dict)
    ]
    body: dict[str, object] = {"events": events}
    cal_status, calendar = _request("GET", f"/calendars/{CALENDAR_ID}")
    if cal_status == 200 and isinstance(calendar, dict):
        zone = str(calendar.get("timeZone") or "").strip()
        if zone:
            body["timeZone"] = zone
    return json.dumps(body)


@mcp.tool()
def create_event(title: str, starts_at: str, attendees: str = "", time_zone: str = "") -> str:
    """Create an event. `starts_at` is RFC 3339. Optional `attendees` are emails
    to invite (comma-separated). Optional `time_zone` is IANA, or UK/London.

    Invites go out when attendees are present (`sendUpdates=all`). There is no
    event id yet, so do not follow this with send_invite for the same people.
    """
    people = attendee_payload(attendees)
    start, end = event_times(starts_at, time_zone)
    body: dict[str, object] = {
        "summary": title,
        "start": start,
        "end": end,
    }
    if people:
        body["attendees"] = people

    kwargs: dict[str, object] = {"json": body}
    if people:
        kwargs["params"] = {"sendUpdates": "all"}
    status, payload = _request(
        "POST",
        f"/calendars/{CALENDAR_ID}/events",
        **kwargs,
    )
    if status not in (200, 201):
        return _fail_json(_message_from(payload, "Could not create the event."), status=status)
    invited = emails_from(attendees)
    return json.dumps(
        {
            "id": payload.get("id"),
            "title": payload.get("summary"),
            "attendees": invited,
        }
    )


@mcp.tool()
def delete_event(event_id: str) -> str:
    """Delete an event by id."""
    status, payload = _request("DELETE", f"/calendars/{CALENDAR_ID}/events/{event_id}")
    if status == 404:
        # Not an error worth failing over: the caller wanted it gone.
        return json.dumps({"deleted": False, "eventId": event_id, "reason": "not found"})
    if status not in (200, 204):
        return _fail_json(_message_from(payload, "Could not delete the event."), status=status)
    return json.dumps({"deleted": True, "eventId": event_id})


@mcp.tool()
def send_invite(event_id: str, email: str) -> str:
    """Invite someone to an existing event. This reaches a third party."""
    status, existing = _request("GET", f"/calendars/{CALENDAR_ID}/events/{event_id}")
    if status != 200:
        return _fail_json(_message_from(existing, "Could not find that event."), status=status)

    attendees = [a for a in (existing.get("attendees") or []) if isinstance(a, dict)]
    if any(a.get("email") == email for a in attendees):
        # Idempotent on purpose. A retried invite must not send a second email
        # to someone who already has one.
        return json.dumps({"invited": True, "eventId": event_id, "already": True})

    status, payload = _request(
        "PATCH",
        f"/calendars/{CALENDAR_ID}/events/{event_id}",
        params={"sendUpdates": "all"},
        json={"attendees": [*attendees, {"email": email}]},
    )
    if status != 200:
        return _fail_json(_message_from(payload, "Could not send the invite."), status=status)
    return json.dumps({"invited": True, "eventId": event_id})


def _now_rfc3339() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    mcp.run()
