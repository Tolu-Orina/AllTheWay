"""A calendar connector, as a real MCP server.

The plan says one connector end to end rather than five half-done, so this is
the one. It speaks MCP over stdio and is launched as a subprocess by the Agent
Gateway — which means the gateway's MCP client is exercised against a genuine
server rather than a stub that agrees with it.

## Why MCP here and A2A everywhere else

They answer different questions. A2A is agent-to-agent: two things that plan and
reason, discovering each other by card. MCP is agent-to-tool: one thing that
reasons, calling something that does not. A calendar does not plan, so it is a
tool, and dressing it as an agent would mean publishing an AgentCard for
something with no agency.

## The store is in memory

Deliberately. A real Google Calendar connector needs OAuth, a project, and a
user who has consented — none of which exist yet. What this proves is the part
that is actually ours: that the gateway can discover a connector's tools, refuse
the ones outside a grant, execute the ones inside it, and screen what comes
back. Swapping this module for one that calls Google changes nothing above it.

## Severity is not declared here

What each tool does in the world lives in the Agent Gateway's registry, not in
this file. A connector describing its own blast radius is a connector that can
understate it — and the gateway is the component that must not take a tool's
word for how dangerous it is. The docstrings below say what each tool does; the
registry is what enforcement reads.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from mcp.server.fastmcp import FastMCP

from _calendar_event import emails_from

mcp = FastMCP("alltheway-calendar")

def _seed() -> list[dict]:
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return [
        {
            "id": "evt-1",
            "title": "Northwind rebrand kickoff",
            "startsAt": (start + timedelta(hours=2)).isoformat(),
            "attendees": ["ana@example.com"],
        },
        {
            "id": "evt-2",
            "title": "Design review",
            "startsAt": (start + timedelta(days=1)).isoformat(),
            "attendees": [],
        },
    ]


_EVENTS: list[dict] = _seed()


@mcp.tool()
def list_events(limit: int = 10, time_min: str = "") -> str:
    """List calendar events. Reads only; changes nothing.

    `time_min` is accepted so the Google connector and this stub share a
    signature. The in-memory store has no clock, so it is ignored.
    """
    del time_min
    return json.dumps({"events": _EVENTS[:limit]})


@mcp.tool()
def create_event(title: str, starts_at: str, attendees: str = "", time_zone: str = "") -> str:
    """Create an event on the user's calendar. Reversible unless attendees are invited."""
    del time_zone
    invited = emails_from(attendees)
    event = {
        "id": f"evt-{len(_EVENTS) + 1}",
        "title": title,
        "startsAt": starts_at,
        "attendees": invited,
    }
    _EVENTS.append(event)
    return json.dumps({"created": event, "id": event["id"], "title": title, "attendees": invited})


@mcp.tool()
def delete_event(event_id: str) -> str:
    """Delete an event. Irreversible — the Agent Gateway requires confirmation."""
    global _EVENTS
    before = len(_EVENTS)
    _EVENTS = [e for e in _EVENTS if e["id"] != event_id]
    return json.dumps({"deleted": before != len(_EVENTS), "eventId": event_id})


@mcp.tool()
def send_invite(event_id: str, email: str) -> str:
    """Email an invite. Irreversible — it leaves the user's account."""
    return json.dumps({"sent": True, "eventId": event_id, "to": email})


if __name__ == "__main__":
    mcp.run()
