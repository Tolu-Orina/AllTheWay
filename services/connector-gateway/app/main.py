"""HTTP surface for the Agent Gateway.

Speaks A2A: JSON-RPC at `/`, discovery at `/.well-known/agent-card.json`.
Internal-only on Cloud Run — invoked by the orchestrator and the watcher
runtime, never from the internet and never by a browser.

There is deliberately no second way to reach a connector. A passthrough endpoint
would be a second place to enforce scope, limits and the autonomy floor, and the
requirement this service exists to meet is that there is exactly one.
"""

from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    add_a2a_routes_to_fastapi,
    create_agent_card_routes,
    create_jsonrpc_routes,
)
from a2a.server.tasks import InMemoryTaskStore
from fastapi import FastAPI

from .a2a_card import build_agent_card
from .a2a_executor import ConnectorExecutor
from .mcp_client import SERVERS
from .registry import TOOL_ACTIONS

app = FastAPI(title="AllTheWay Agent Gateway")

agent_card = build_agent_card()
executor: AgentExecutor = ConnectorExecutor()
request_handler = DefaultRequestHandler(
    agent_executor=executor,
    task_store=InMemoryTaskStore(),
    agent_card=agent_card,
)

add_a2a_routes_to_fastapi(
    app,
    agent_card_routes=create_agent_card_routes(agent_card),
    jsonrpc_routes=create_jsonrpc_routes(request_handler, rpc_url="/"),
)


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "agent": agent_card.name,
        "cardVersion": agent_card.version,
        "connectors": sorted(SERVERS),
        # The registry is the enforcement surface, so it is worth being able to
        # see what this revision believes each tool does.
        "tools": {c: sorted(t) for c, t in ((k, v) for k, v in TOOL_ACTIONS.items())},
    }
