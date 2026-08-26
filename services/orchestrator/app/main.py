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

from alltheway_agentcards.a2a import attach_signature

from .a2a_card import build_agent_card
from .a2a_executor import OrchestratorExecutor
from .providers import create_provider

app = FastAPI(title="AllTheWay orchestrator")

provider = create_provider()
agent_card = build_agent_card()

# Signed before the routes are built from it.
#
# An A2A client talks to the URL the *card* advertises, not the one it was
# handed — so whatever can answer a card fetch can redirect this agent's
# traffic, rename its skills, or declare a weaker security scheme. IAM stops
# that between our own services today; the registry exists so agents we did not
# deploy become discoverable, and at that point "it came from the right host"
# stops being an argument.
#
# Returns False when no key is configured, which is a supported state: the card
# is still served, and a verifier that requires a signature refuses it rather
# than being quietly satisfied.
if attach_signature(agent_card):
    print(f"[{app.title}] agent card signed", flush=True)

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


# Both spellings, deliberately.
#
# Google's frontend on *.run.app swallows the exact path `/healthz` — it
# returns Google's own 404 and the request never reaches the container (proven
# by its absence from the logs, while /api/... from the same probe appears).
# `/healthz/` gets through. FastAPI would answer that with a 307 redirect to
# the path that does not arrive, so the trailing-slash route is declared
# explicitly rather than left to redirect_slashes.
#
# Registering both means whoever writes the next probe cannot pick the wrong
# one. See open decision 7 in docs/AllTheWay-A2A-and-Platform-Plan.md.
@app.get("/healthz")
@app.get("/healthz/", include_in_schema=False)
def healthz() -> dict:
    return {
        "ok": True,
        "provider": type(provider).__name__,
        "agent": agent_card.name,
        "cardVersion": agent_card.version,
    }

