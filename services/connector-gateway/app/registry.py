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
    "calendar": {
        "list_events": None,
        "create_event": Action.CREATE_TASK,
        "delete_event": Action.DELETE_DATA,
        "send_invite": Action.SEND_EXTERNAL,
    },
}


class UnregisteredTool(LookupError):
    """A tool nobody has classified. Refused rather than guessed at."""


def action_for(connector: str, tool: str) -> Action | None:
    tools = TOOL_ACTIONS.get(connector)
    if tools is None or tool not in tools:
        raise UnregisteredTool(f"{connector}.{tool} has no declared severity.")
    return tools[tool]


def registered_tools(connector: str) -> frozenset[str]:
    return frozenset(TOOL_ACTIONS.get(connector, {}))
