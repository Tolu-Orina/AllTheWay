"""Talking to connectors over MCP.

One session per call, over stdio. That is not the fastest arrangement and it is
the right one for now: a long-lived subprocess shared between users is a place
for one user's connector state to leak into another's, and the gateway is the
component least able to afford that.

When a connector becomes remote (Streamable HTTP against a hosted MCP server),
only `_connect` changes — everything above it works in terms of tool names and
JSON, not transports.
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

#: Where connector servers live. Each is a module run as a subprocess.
CONNECTORS_DIR = Path(__file__).resolve().parent.parent / "connectors"

#: Registered connectors. Adding one is adding a line here plus a server module;
#: it is deliberately not discovery-by-scanning, because a connector appearing
#: because someone dropped a file in a directory is how a supply chain problem
#: starts.
SERVERS: dict[str, str] = {
    "calendar": "calendar_server.py",
}


class ConnectorUnavailable(RuntimeError):
    """The connector could not be reached or refused the call."""


@dataclass(frozen=True)
class ToolResult:
    text: str

    def json(self) -> dict:
        try:
            return json.loads(self.text)
        except ValueError:
            # A connector that returns prose rather than JSON is not an error;
            # it is just not structured. The caller decides what to do with it.
            return {"text": self.text}


#: Exactly what a connector subprocess is given. An allow-list rather than a
#: deny-list: a new credential in the gateway's environment is not one a
#: connector can read by default.
_PASSED_THROUGH = ("PATH", "PYTHONPATH", "PYTHONHOME", "SYSTEMROOT", "TEMP", "TMP")


def _connector_env() -> dict[str, str]:
    env = {name: os.environ[name] for name in _PASSED_THROUGH if name in os.environ}
    env["PYTHONUNBUFFERED"] = "1"
    return env


@asynccontextmanager
async def _connect(connector: str):
    script = SERVERS.get(connector)
    if script is None:
        raise ConnectorUnavailable(f"{connector} is not a registered connector.")

    path = CONNECTORS_DIR / script
    if not path.exists():
        raise ConnectorUnavailable(f"{connector} server is missing at {path}.")

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(path)],
        # A connector inherits nothing by default. Anything it needs arrives
        # explicitly, which is what keeps a connector subprocess from reading
        # the gateway's own credentials out of its environment.
        #
        # PYTHONPATH is the one exception, and it is not a loosening: it is how
        # this interpreter finds its own modules. The image installs
        # dependencies to /deps rather than site-packages, so without it the
        # connector cannot import `mcp` and dies on connect. That failed only
        # in the image — locally the packages are in site-packages and no path
        # is needed, so the stripped environment looked fine.
        env=_connector_env(),
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_tools(connector: str) -> frozenset[str]:
    """What this connector actually offers.

    Asked rather than assumed: the Agent Gateway refuses a tool the connector
    does not offer before it consults the grant, so a stale grant naming a
    removed tool produces a clear answer instead of a confusing one.
    """
    async with _connect(connector) as session:
        listed = await session.list_tools()
        return frozenset(tool.name for tool in listed.tools)


async def call_tool(connector: str, tool: str, arguments: dict) -> ToolResult:
    async with _connect(connector) as session:
        result = await session.call_tool(tool, arguments)

        if getattr(result, "isError", False):
            raise ConnectorUnavailable(f"{connector}.{tool} failed.")

        parts = [
            block.text
            for block in (result.content or [])
            if getattr(block, "type", None) == "text"
        ]
        return ToolResult(text="\n".join(parts))
