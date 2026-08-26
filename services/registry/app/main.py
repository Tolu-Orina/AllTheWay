"""The Agent Registry.

Phase 7's exit criterion is that a new agent is discoverable by card alone, and
that every action is attributable to an agent version and an identity. This
service is the first half: one place that lists every agent, what it offers,
who owns it, and whether its card can be trusted.

Internal-only, like every other backend service. The browser reaches it through
the gateway, which is the only service it can talk to — and the gateway is
given invoker rights on this service and on nothing else it did not already
have. The registry holds no connector power, so that grant does not weaken the
rule that the browser has no path to a connector outside policy enforcement.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .catalogue import describe, describe_one

app = FastAPI(title="AllTheWay registry")


# Both spellings, deliberately: Google's frontend on *.run.app swallows the
# exact path `/healthz`, and FastAPI would answer `/healthz/` with a 307 back
# into the intercepted path.
@app.get("/healthz")
@app.get("/healthz/", include_in_schema=False)
def healthz() -> dict:
    return {"ok": True}


@app.get("/agents")
async def agents() -> dict:
    """Every agent, with its card fetched and its signature checked now.

    Deliberately not cached. A catalogue that says an agent was trustworthy
    five minutes ago is answering a question nobody asked; the useful question
    is whether it is trustworthy now.
    """
    return await describe()


@app.get("/agents/{agent_id}")
async def agent(agent_id: str) -> dict:
    record = await describe_one(agent_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No such agent.")
    return record
