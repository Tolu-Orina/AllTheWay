# The Research Cell does not use ADK

**Status:** accepted · **Date:** 2026-08-25 · **Phase:** 3 (Research Cell)

## Decision

The research cell fans out with `asyncio.gather` over two named angles and
synthesises with a third call. It does not use `google.adk`. The orchestrator
calls it with the A2A client it already has, not `RemoteA2aAgent`.

This reverses what the Phase 3 plan specified.

## Why the plan said ADK

Phase 1 deferred ADK explicitly, with this reasoning:

> ADK's value is agent composition (`ParallelAgent`, branch isolation), which
> Phase 3 needs for the Research Cell.

So Phase 3 was the moment to adopt it, and the plan named `ParallelAgent` and
`RemoteA2aAgent` directly. That deferral is now spent, and it should be honoured
or explicitly withdrawn — not quietly forgotten.

## What checking found

`google-adk` 2.7.1 was installed and the class read before deciding.

**`ParallelAgent` carries a deprecation decorator:**

> `ParallelAgent is deprecated in favor of Workflow and will be removed in a
> future version. Workflow cannot yet be used as an LlmAgent sub-agent.`

Two problems, not one. The class we were told to build on is scheduled for
removal, and its named replacement carries a limitation that blocks the
composition it replaces. `Workflow` is also not exported from
`google.adk.agents` in 2.7.1, so the migration target is not yet available.

**It also does not provide what makes this cell bounded.** Reading
`_run_async_impl`: it creates a branch context per sub-agent, merges their event
streams, and closes the generators in a `finally`. There is no token accounting,
and a sub-agent that raises propagates — the opposite of degrading gracefully. A
`timeout` field exists but is undocumented. Every bound in `budget.py` and every
degradation path in `cell.py` would have had to be written anyway.

**The isolation argument does not apply.** The plan said "branch isolation is
ADK-native: workers cannot observe each other mid-flight". ADK's branch
isolation solves the problem of sub-agents sharing one session and event stream.
Our workers are separate function calls with separate prompt strings and no
shared mutable state — there is no channel through which one could observe
another. The isolation is structural here; there is nothing for a framework to
isolate.

## What adopting it would have cost

- A second agent framework alongside the hand-rolled A2A server that already
  works and is tested.
- Two model-access paths. `ResearchProvider` with its `max_output_tokens`
  argument is what makes the token budget a real cap and what lets the whole
  cell run with no credentials. ADK's `LlmAgent` would either bypass it —
  losing the zero-credential test story — or need a shim larger than the code it
  replaced.
- `RemoteA2aAgent` would pull the ADK runtime (Runner, SessionService,
  InvocationContext) into the orchestrator to do what `research_client.py` does
  in eighty lines against the same protocol.

## Consequences

- `google-adk` is removed from the orchestrator's `vertex` optional dependency,
  where it was declared and never imported. Nothing in this repo uses ADK.
- The concurrency is `asyncio.gather(..., return_exceptions=True)` over a
  dedicated thread pool, which is what makes losing one worker survivable.
- If ADK's `Workflow` lands and is usable as a sub-agent, this is worth
  revisiting. The A2A card would not change, so the cell's internals could be
  replaced without any caller noticing — which is the property that makes this
  decision cheap to reverse.

## What this does not change

A2A remains the boundary between every agent. The decision is about what runs
*inside* a cell, not how cells talk to each other.
