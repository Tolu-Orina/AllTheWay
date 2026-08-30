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
    # In-memory. Local runs and tests; reaches no account.
    "calendar": "calendar_server.py",
    # Real Google accounts. Each is a separate process, launched per call, so
    # one connector's bug cannot read another's credential.
    "google_calendar": "google_calendar_server.py",
    "google_gmail": "gmail_server.py",
    "google_drive": "drive_server.py",
    "google_docs": "docs_server.py",
    # Generation. Uses the service's own Vertex identity, so it is deliberately
    # absent from NEEDS_OAUTH — nothing here touches a user's account.
    "media": "media_server.py",
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

#: Media calls Vertex with the service identity. The subprocess is otherwise
#: stripped, so without the project the URL is `projects//locations/...` and
#: generation 400s after a successful A2A handshake.
_MEDIA_ENV = (
    "GOOGLE_CLOUD_PROJECT",
    "MEDIA_LOCATION",
    "IMAGE_MODEL",
    "VIDEO_DRAFT_MODEL",
    "VIDEO_STANDARD_MODEL",
    "VIDEO_FINAL_MODEL",
)


def _connector_env(
    credentials: dict[str, str] | None = None,
    *,
    connector: str = "",
) -> dict[str, str]:
    env = {name: os.environ[name] for name in _PASSED_THROUGH if name in os.environ}
    env["PYTHONUNBUFFERED"] = "1"
    if connector == "media":
        for name in _MEDIA_ENV:
            if name in os.environ:
                env[name] = os.environ[name]

    # Credentials are added per call, by the gateway, for this one invocation.
    # They are never read from the gateway's own environment: that is what
    # keeps "the connector needs a token" from becoming "the connector can see
    # every token this process holds".
    env.update(credentials or {})
    return env


@asynccontextmanager
async def _connect(connector: str, credentials: dict[str, str] | None = None):
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
        env=_connector_env(credentials, connector=connector),
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


#: Process-lifetime. Connectors do not change without a deploy, and spawning
#: a Python subprocess just to ask the same four names on every call is what
#: made a calendar read miss a six-second budget on a cold instance.
_offered: dict[str, frozenset[str]] = {}


def forget_tools(connector: str | None = None) -> None:
    """Drop the offered-tools cache. Tests, and nothing in production."""
    if connector is None:
        _offered.clear()
        return
    _offered.pop(connector, None)


async def list_tools(connector: str) -> frozenset[str]:
    """What this connector actually offers.

    Asked rather than assumed: the Agent Gateway refuses a tool the connector
    does not offer before it consults the grant, so a stale grant naming a
    removed tool produces a clear answer instead of a confusing one.
    """
    cached = _offered.get(connector)
    if cached is not None:
        return cached
    async with _connect(connector) as session:
        listed = await session.list_tools()
        names = frozenset(tool.name for tool in listed.tools)
    _offered[connector] = names
    return names


async def call_tool(
    connector: str,
    tool: str,
    arguments: dict,
    credentials: dict[str, str] | None = None,
) -> ToolResult:
    async with _connect(connector, credentials) as session:
        result = await session.call_tool(tool, arguments)

        if getattr(result, "isError", False):
            raise ConnectorUnavailable(f"{connector}.{tool} failed.")

        parts = [
            block.text
            for block in (result.content or [])
            if getattr(block, "type", None) == "text"
        ]
        return ToolResult(text="\n".join(parts))
