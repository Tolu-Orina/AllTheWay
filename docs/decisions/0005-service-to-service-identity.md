# Service-to-service identity: clients attach, Cloud Run verifies

**Status:** accepted · **Date:** 2026-08-25 · **Phase:** 1, item 1.4

## Decision

Every A2A client attaches a Google-signed OIDC identity token, minted for the
callee's base URL as audience. **Verification is Cloud Run's**, not the
application's.

- Gateway (`services/gateway/src/a2a.ts`): a `fetchImpl` passed to both the
  transport factory and the card resolver.
- Python (`libs/agentauth`): shared by the orchestrator and the watcher runtime.

## This was a live bug, not hardening

Item 1.4 was deferred through Phases 1–5 on the stated grounds that there was no
real identity to verify against. That reasoning was sound for the *verification*
half and completely missed the other half: **no client attached a credential at
all.**

Internal services run `INGRESS_TRAFFIC_INTERNAL_ONLY` with `run.invoker` granted
per caller. Cloud Run rejects requests without a valid token. So in the deployed
system the gateway could not reach the orchestrator, the orchestrator could not
reach the research cell, and the watcher could not reach the orchestrator —
every A2A call, broken.

It was invisible for four phases because **locally nothing requires auth**. Every
test, every container-to-container check on a Docker network, every verify
script — all passed, because none of them had a boundary to cross.

## Why verification stays with Cloud Run

Cloud Run checks signature, issuer and audience and enforces IAM *before the
request reaches the container*. An in-process check is strictly weaker: a
compromised process can skip its own middleware, and cannot skip the platform's.

This is also what the plan asked for — "so the A2A layer and the IAM layer agree
rather than duplicating". The card's `HTTPAuthSecurityScheme` (bearer) is now an
accurate description of what happens, rather than an aspiration.

## Why it degrades instead of refusing

When no token can be minted, the request goes out unauthenticated.

That reads like a weakening and is not one. On a developer machine there is no
metadata server and the local services require nothing, so refusing would make
the whole stack unrunnable offline. In production, Cloud Run rejects the
unauthenticated request anyway — the boundary is unchanged either way. Failing
hard would defend a boundary the platform already defends, and the only thing it
would reliably break is local development.

The Python side logs at debug rather than warning for the same reason: on a
laptop this is the normal path, and a warning per call teaches everyone to ignore
the log.

## One token per audience

Cloud Run checks the audience, so a token minted for the orchestrator is rejected
by the research cell. A single global token would fail in a way that looks like a
permissions problem rather than an audience problem. Tokens are therefore cached
per target, and re-minted a few minutes before expiry so a credential never
expires mid-flight.

## Consequences

- `google-auth-library` is now a declared gateway dependency; it was previously
  only transitive via `firebase-admin`, which is the kind of thing that breaks on
  an unrelated upgrade.
- `libs/agentauth` is the third shared library, after `policy` and `screening`.
  The rule holds: one copy of anything safety-bearing, because two copies drift
  and the drift is silent.
- The card fetch is authenticated too. It is a request to the same closed
  service and it happens *before* any RPC, so an unauthenticated resolver would
  fail first and look like a discovery problem.
