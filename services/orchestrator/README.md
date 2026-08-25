# orchestrator

The graph that decides whether a request is clear enough to act on, and builds
the plan if it is. Internal-only on Cloud Run: invoked by the gateway's service
account, never reachable from the internet.

```
turn -> Clarify Gate -+- ambiguous -> ask one question, stop
                      +- clear -----> build plan -> return
```

## Running

```bash
pip install -e ".[vertex]"        # or just fastapi/uvicorn/pydantic for the fake
python -m uvicorn app.main:app --port 8090
python -m pytest tests -q
```

`GET /healthz` reports which provider is active, so you can never be unsure
whether you are talking to a model or the fake.

## Deliberate choices

**The gate is a hard branch, not a hint.** An ambiguous request returns before
the plan node is reached, so nothing downstream can act on it. The response type
enforces this too: `decision` is either `clarify` or `plan`, never both.

**An empty plan falls back to a question.** A zero-step plan is not a plan, and
rendering it as an empty checklist would be worse than asking again.

**Preferences go in the system context, never appended to the user's message.**
Concatenating them makes them indistinguishable from something the user said,
which corrupts any echo of the request back to them — and is precisely the shape
prompt injection takes once Watchers start feeding in untrusted external
content.

**The model is behind `ModelProvider`.** `FakeProvider` is deterministic and
needs no credentials, so the graph is fully testable without a GCP project.
`VertexProvider` uses ADC against the `global` endpoint, pinned to
`gemini-3.6-flash` — never `latest`, because a silent model swap changes agent
behaviour underneath you. Selection is explicit: `USE_VERTEX=true` plus a
project, or you get the fake. It never half-connects.

**The orchestrator is stateless.** The gateway reads the profile and passes it
in, so this service needs no database and its tests need no fixtures.

## A2A

This agent speaks [A2A](https://a2a-protocol.org) v1.0 and nothing else. There is
no bespoke HTTP contract left: `POST /turn` was removed once both callers
migrated, so the protocol is the only way in.

| | |
|---|---|
| Discovery | `GET /.well-known/agent-card.json` |
| JSON-RPC | `POST /` — `SendMessage`, `GetTask`, `CancelTask`, … |
| Health | `GET /healthz` (not part of A2A; Cloud Run needs it) |

### The Clarify Gate is a protocol state

`TASK_STATE_INPUT_REQUIRED` means exactly what the gate means: the agent stopped
and needs something from you before it can continue. So the gate is not encoded
in a bespoke `decision` field that callers must learn — **any conformant A2A
client gets it for free**, without knowing anything about AllTheWay.

```
ambiguous request -> clarification artifact + TASK_STATE_INPUT_REQUIRED
clear request     -> plan artifact          + TASK_STATE_COMPLETED
planner exploded  -> TASK_STATE_FAILED
```

### Deliberate choices

**The card is hand-authored** (`app/a2a_card.py`), not generated. It is a public
contract other agents discover us by, so it belongs in review next to the code
it describes.

**The card said `streaming: false` until it was true.** Card 1.1.0 flipped it,
in the same change that made the executor emit incremental events. Advertising a
capability we have not built is a lie in a contract that clients read to decide
how to call us.

**One skill, not two.** "Clarify" is not a capability — it is an outcome state
of `plan_session`.

**Preferences travel in message metadata**, never appended to the user's text.
Concatenating them makes context indistinguishable from something the user said,
which corrupts any echo of the request and is precisely the shape prompt
injection takes once untrusted content is in play.

**The Task must be enqueued before any status event**, or the framework rejects
the whole response as `INVALID_AGENT_RESPONSE`. `TaskUpdater` only emits updates;
it never creates the task it updates. This ordering is covered by a test.

**Auth is declared, not yet enforced.** The card advertises
`HTTPAuthSecurityScheme` (bearer, Google-signed OIDC) — the same identity
Terraform already grants `run.invoker`. Enforcement lands when there is a real
Cloud Run identity to verify against; today the service is protected by
`INGRESS_TRAFFIC_INTERNAL_ONLY`, which Terraform sets. No API keys: there is
nothing stealable in this architecture today and adding a key would create the
first thing worth stealing.

### Streaming

The executor consumes `run_turn_stream` and emits as it goes:

| graph event | A2A |
|---|---|
| trace line | `TaskStatusUpdateEvent` (WORKING) |
| plan step | `TaskArtifactUpdateEvent`, appended to one artifact |

Streaming is **not a second code path**. `message/send` produces the identical
events; the task store folds them into one finished task before returning it. So
a caller that cannot stream sees exactly what a streaming caller would have seen
at the end — the only difference is when. `run_turn` is likewise just
`run_turn_stream`, collected, so a streaming bug and a non-streaming bug are the
same bug.

**Every emitted value is final.** `jsonstream.parse_partial` truncates a
half-arrived JSON document back to its last *complete* value, so a step label is
never shown and then reworded. That is what lets a UI append rather than
reconcile.

**The graph runs on a worker thread** (`app/aio.py`). It is a synchronous
generator and model SDKs block between chunks; consuming it directly inside
`async def execute` never yields the event loop, so every event arrived at once
after the turn had already finished. Everything compiled and every test passed
while that was true — it was only visible in arrival timings.

`FAKE_STREAM_DELAY_MS` slows the fake provider so a plan panel filling in is
observable locally. It is off by default, it delays a real answer rather than
inventing progress, and `FakeProvider` is never used in a deployed service.

### Research delegation

When the gate says a request is clear *and* that it turns on facts to look up,
the turn is planned twice:

```
gate -> needsResearch? -> research cell (A2A) -> plan, informed by the finding
```

Only the cell's synthesis re-enters the graph. Its trace is relayed and
attributed (`Research cell: ...`) so a user can see a swarm ran and how it went;
worker output never crosses the boundary — see the cell's README for how that is
enforced on its side.

**Steps from the first pass are held back** while it is unknown whether the
informed pass will replace them. Streaming a step and then rewriting it would
break the invariant everything else here rests on. An ordinary turn is
unaffected: `needsResearch` arrives before `steps`, so steps still stream as
they land.

**A cell that does not answer is not fatal.** `research_client.research` returns
`None` on every failure path, the held steps are released, and the trace says
research was skipped. Research makes a plan better; it is not a precondition for
having one.

The gate runs first, so an ambiguous request never spends a swarm's budget.

### Voice

Two things make a spoken turn different from a typed one, and only two live in
`app/voice.py`.

**FR-V4 — do not act on a guess.** Confidence is checked twice, against
different bars, because one cutoff would treat "draft me a note" and "wire the
deposit" as equal risk:

| band | behaviour |
|---|---|
| `< 0.55` | stop **before the model is called** and ask for it in text |
| `0.55–0.80` | plan, but quote the transcript back before acting |
| `>= 0.80` | proceed as a typed turn |
| irreversible | needs `>= 0.92` regardless of ceiling |

**FR-V2 — confirm before acting.** A plan step declares what it would change
(`action`), and anything that changes something outside the conversation stops
the turn until the user agrees. The decision itself is
`alltheway_policy.decide` — the same function the watcher runtime uses, shared
rather than copied, because two copies of a safety rule drift silently until
something irreversible happens on the surface nobody updated.

**The gate is the Clarify Gate.** Same `TASK_STATE_INPUT_REQUIRED`, different
reason, different artifact (`confirmation` vs `clarification`). No new skill, no
new protocol state.

**It applies to typed turns too.** FR-V2 sits under Voice, but the rule is about
consequences rather than microphones, and the architecture runs both modalities
through one graph.

An unrecognised action is treated as irreversible, so a planner cannot invent
its way past the gate; an unrecognised ceiling reads as the most restrictive, so
a typo in a stored profile can never widen what may happen.

### ADK

Not used at all, and no longer expected to be.

Phase 1 deferred it on the grounds that its value is agent composition
(`ParallelAgent`, branch isolation) and that Phase 3 would need it for the
Research Cell. Phase 3 installed `google-adk` 2.7.1 and read the class before
deciding: `ParallelAgent` is deprecated, its named replacement is not usable as
a sub-agent and is not exported in that version, and it provides none of the
bounds a swarm needs — no token accounting, and a raising sub-agent propagates
instead of degrading.

So the deferral is withdrawn rather than left open. Full reasoning in
[decisions/0002](../../docs/decisions/0002-no-adk-for-the-research-cell.md).
`to_a2a()` could still replace this hand-rolled server without altering the card
or the JSON-RPC surface, but there is now no reason to.
