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
