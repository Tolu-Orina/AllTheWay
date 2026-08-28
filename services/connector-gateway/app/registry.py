"""What every connector tool actually does, as far as enforcement is concerned.

This lives in the gateway rather than in each connector on purpose. A connector
that declares its own blast radius is a connector that can understate it, and
the gateway is precisely the component that must not take a tool's word for how
dangerous it is.

It is also fail-closed: a tool absent from this table is refused. A connector
that gains `wire_transfer` in a new version does not gain the ability to call it
by shipping — someone adds a line here, in a diff a human reads.
"""

from __future__ import annotations

from alltheway_policy import Action

#: connector -> tool -> what it does in the world. `None` means it only reads,
#: and a read is governed by scope and limits rather than by the autonomy floor.
TOOL_ACTIONS: dict[str, dict[str, Action | None]] = {
    # In-memory. Local runs and tests only; it reaches no account.
    "calendar": {
        "list_events": None,
        "create_event": Action.CREATE_TASK,
        "delete_event": Action.DELETE_DATA,
        "send_invite": Action.SEND_EXTERNAL,
    },
    # The same four tools against a real Google account.
    #
    # A separate entry rather than a flag on the one above, so which connector
    # ran is visible in the call and in the trace. A single "calendar" that
    # silently means memory in one environment and a real diary in another is
    # the kind of ambiguity that ends with someone deleting a real event while
    # believing they are testing.
    "google_calendar": {
        "list_events": None,
        "create_event": Action.CREATE_TASK,
        "delete_event": Action.DELETE_DATA,
        "send_invite": Action.SEND_EXTERNAL,
    },
    "google_gmail": {
        # Sending reaches a third party and cannot be taken back.
        "send_email": Action.SEND_EXTERNAL,
        # A draft changes nothing outside the user's own account until they
        # send it. Action.DRAFT is the lowest rung of the floor, which is what
        # makes a DRAFT_ONLY ceiling mean something concrete here.
        "create_draft": Action.DRAFT,
    },
    "google_drive": {
        "list_files": None,
        "create_file": Action.CREATE_TASK,
        "delete_file": Action.DELETE_DATA,
    },
    # Generated media. No user account is touched, so no OAuth — but real
    # money is spent, which is what the severities below are about.
    "media": {
        # Cheap enough to be conversational: ~$0.034 per thousand images.
        "generate_image": Action.CREATE_TASK,
        # ~$0.05/second. Confirmed, but not treated as irreversible.
        # Starts the Veo LRO. The meter is on this call: Vertex bills then.
        "draft_video": Action.CREATE_TASK,
        # A read of an operation the user already paid to start.
        "poll_draft_video": None,
        # ~$0.75/second — an 8-second render is about six dollars.
        #
        # MAKE_PAYMENT is not a metaphor here. It is the highest rung of the
        # autonomy floor, so this can never be reached unattended at any
        # ceiling and inherits the double confirmation the floor already
        # applies to moving money. The most expensive action in the product is
        # governed by the machinery built for the most dangerous one.
        "render_video": Action.MAKE_PAYMENT,
    },
    "google_docs": {
        "read_document": None,
        "create_document": Action.CREATE_TASK,
        "append_text": Action.UPDATE_RECORD,
    },
}

#: Connectors that act on a real account and therefore need a per-user
#: credential. Absent from this set means the connector needs none.
#:
#: Kept beside the severity table because both are the same kind of fact: what
#: the gateway must know about a connector that the connector must not be
#: trusted to declare about itself.
#: Which meter a tool spends from, and how much one call costs.
#:
#: Kept beside the severity table because both are the same kind of fact: what
#: the gateway must know about a tool that the tool must not be trusted to
#: declare about itself. A connector that reported its own cost could report
#: zero.
#:
#: The value is the unit charged per call; for video the caller supplies
#: seconds, so the charge is per second.
TOOL_METERS: dict[str, dict[str, str]] = {
    "media": {
        "generate_image": "images",
        "draft_video": "draft_video_seconds",
        "render_video": "final_video_seconds",
    },
}


def meter_for(connector: str, tool: str) -> str | None:
    """Which meter this call spends from, or None if it is not metered."""
    return TOOL_METERS.get(connector, {}).get(tool)


NEEDS_OAUTH: frozenset[str] = frozenset(
    {"google_calendar", "google_gmail", "google_drive", "google_docs"}
)


class UnregisteredTool(LookupError):
    """A tool nobody has classified. Refused rather than guessed at."""


def action_for(connector: str, tool: str) -> Action | None:
    tools = TOOL_ACTIONS.get(connector)
    if tools is None or tool not in tools:
        raise UnregisteredTool(f"{connector}.{tool} has no declared severity.")
    return tools[tool]


def registered_tools(connector: str) -> frozenset[str]:
    return frozenset(TOOL_ACTIONS.get(connector, {}))
