# Research Cell

A bounded swarm. Two workers investigate one topic from independent angles, a
third call synthesises them, and exactly one answer leaves.

```
topic ──┬── mainstream   ─┐
        └── counterpoint ─┴── synthesis ──> one answer
```

Reachable only over [A2A](https://a2a-protocol.org). Internal-only on Cloud Run,
invoked by the orchestrator's service account, never by a browser.

| | |
|---|---|
| Discovery | `GET /.well-known/agent-card.json` |
| JSON-RPC | `POST /` — one skill, `research_topic` |
| Health | `GET /healthz` — reports the budget it enforces |

## The swarm never touches the user

Manifest FR-10. Enforced in three places, so no single edit can undo it:

1. **The type.** `ResearchResult` has no field that can carry a worker's text.
   Worker output is a local, consumed by synthesis, then out of scope. Returning
   it would mean changing the type — a reviewable diff, not a silent leak.
2. **The protocol.** The executor emits exactly one artifact, asserted by a
   test. That is the guard against a future "and the raw findings, for
   debugging" attachment.
3. **The card.** One skill, one output mode. A caller cannot discover a way to
   address a worker or request raw findings, because no such surface is offered.

When synthesis fails, the answer says so. It never falls back to handing back a
worker's response — that is exactly the leak, dressed up as a helpful
degradation.

## Bounded in code, not in a prompt

A prompt-level bound is a request the model may ignore. These cannot be exceeded:

| bound | how |
|---|---|
| 2 workers | no loop — the fan-out is over two named constants |
| 1 round | there is no iterate-until-satisfied construct anywhere |
| wall clock | a deadline, **split** so the fan-out cannot spend synthesis's time |
| tokens | `max_output_tokens` sent *with* the request, plus a refusal to start a call the remaining budget cannot pay for |

The token point is the subtle one: counting tokens after a response arrives
tells you that you overspent. The cap has to travel with the request.

**Both reserves exist because of the same failure.** A greedy pair of workers
would leave nothing to answer with; a single *hung* worker would consume the
whole deadline and return "could not turn findings into an answer" — discarding
a good finding it already had. Losing a worker should cost breadth, not the
answer, and that only holds if there is time and budget left to write it.

The second one was found by hanging a worker against a running service. No unit
test at the time caught it, because every unit test was fast.

## What the wall clock can and cannot do

It reliably bounds *the caller*: a hung worker stops being waited on and the run
returns. It does not kill the hung call — Python cannot kill a thread — so that
thread lives until its own request returns, holding a slot in a dedicated pool.

The bound that stops the thread is the provider's request timeout
(`RESEARCH_REQUEST_TIMEOUT_S`), not the deadline. Both exist on purpose: the
deadline protects the answer, the request timeout protects the process. Claiming
the deadline does both would show up as thread-pool exhaustion under load rather
than as a failing test.

## Degradation is not failure

A run that lost a worker still `COMPLETE`s and sets `degraded: true`. The caller
got a usable answer and is told how much breadth it rests on. `FAILED` is
reserved for something genuinely unexpected — the cell degrades internally
rather than raising.

## No ADK

The plan called for ADK's `ParallelAgent`. It is deprecated in 2.7.1, its named
replacement is not yet usable, and it provides none of the bounds above. See
[decisions/0002](../../docs/decisions/0002-no-adk-for-the-research-cell.md).

## Running it

```bash
python -m uvicorn app.main:app --port 8093
python -m pytest tests -q
python scripts/verify_cell.py healthy     # against a running service
```

Fault injection, fake provider only, for verifying degradation against a running
service rather than only against stubs:

```bash
FAKE_RESEARCH_FAIL=counterpoint            python -m uvicorn app.main:app --port 8093
FAKE_RESEARCH_HANG_S_COUNTERPOINT=30       python -m uvicorn app.main:app --port 8093
```

Then `python scripts/verify_cell.py degraded` / `hung`.
