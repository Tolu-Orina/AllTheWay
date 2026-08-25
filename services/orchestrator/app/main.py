"""HTTP surface for the orchestrator.

Speaks A2A: JSON-RPC 2.0 at `/`, discovery at `/.well-known/agent-card.json`.
Internal-only on Cloud Run — invoked by the gateway's service account, never
reachable from the internet.

There is deliberately no second way in: the bespoke `POST /turn` was removed once
both callers spoke A2A, so the protocol is the only entry point rather than the
preferred one.
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
from .a2a_executor import OrchestratorExecutor
from .providers import create_provider

app = FastAPI(title="AllTheWay orchestrator")

provider = create_provider()
agent_card = build_agent_card()

executor: AgentExecutor = OrchestratorExecutor(provider)
request_handler = DefaultRequestHandler(
    agent_executor=executor,
    # In-memory is correct while a task is a single short turn. When Phase 2
    # makes tasks resumable across a reconnect, this becomes a Firestore-backed
    # store — the interface is the seam for that.
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
        "provider": type(provider).__name__,
        "agent": agent_card.name,
        "cardVersion": agent_card.version,
    }

