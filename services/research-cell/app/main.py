"""HTTP surface for the research cell.

Speaks A2A: JSON-RPC 2.0 at `/`, discovery at `/.well-known/agent-card.json`.
Internal-only on Cloud Run — invoked by the orchestrator's service account,
never reachable from the internet, and never by a browser.

There is deliberately no second way in. In particular there is no endpoint that
returns a worker's findings: the swarm has exactly one exit, and it is the
synthesised artifact (FR-10).
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
from .a2a_executor import ResearchExecutor
from .budget import Budget
from .providers import create_provider

app = FastAPI(title="AllTheWay research cell")

provider = create_provider()
budget = Budget()
agent_card = build_agent_card()

executor: AgentExecutor = ResearchExecutor(provider, budget)
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
        "provider": type(provider).__name__,
        "agent": agent_card.name,
        "cardVersion": agent_card.version,
        "budget": {
            "workers": budget.workers,
            "wallClockS": budget.wall_clock_s,
            "totalOutputTokens": budget.total_output_tokens,
        },
    }
