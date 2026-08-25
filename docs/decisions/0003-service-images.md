# Service images: root context, pinned runtimes, tests as a build stage

**Status:** accepted · **Date:** 2026-08-25 · **Phase:** 4 (Ship it)

Five images: `gateway` (Node), `orchestrator`, `watcher-runtime`,
`profile-synthesizer`, `research-cell` (Python). All multi-stage, all distroless,
all non-root.

## Python is 3.11, not 3.13

The plan specified `python:3.13-slim` building into distroless. That combination
does not work: `gcr.io/distroless/python3-debian12` ships **Python 3.11.2**.
Wheels built on 3.13 carry `cp313` ABI tags and land in a `python3.13`
site-packages directory, so the image builds cleanly and then fails at the first
import.

The build stage is therefore pinned to the runtime's interpreter, and the test
stage runs on it too — the suite exercises the interpreter that will serve
traffic, not the one that happens to be on a laptop. All 107 tests pass on 3.11.

Node is `node:22-slim` → `distroless/nodejs22` (v22.22.0). Local dev is on Node
24; that skew is safe in a way the Python one is not, because there is no native
ABI involved and the test stage still runs on 22.

## The build context is the repo root

`docker build -f services/<svc>/Dockerfile .` — always from the root.

The gateway imports `@alltheway/contracts`, a sibling workspace. A context of
`services/gateway` cannot see `../contracts`: `COPY` refuses to leave its
context. Rather than making the gateway a special case that breaks the moment
someone copies a Dockerfile, every service builds the same way.

The cost is a single root `.dockerignore` doing real work — without it the
daemon receives a `node_modules` larger than any image we ship. Per-service
`.dockerignore` files, which the plan called for, are **not** used: Docker reads
the one at the context root, so per-service copies would be silently ignored.
One file that works beats five that look reassuring.

## The test stage is a build stage

```
deps → test → final
```

`docker build --target test` exits non-zero when a test fails. Verified by
introducing a deliberately failing test: the build stopped with exit 1. That is
the difference between a gate and a report.

Note BuildKit prunes stages nothing depends on, so a plain `docker build` does
**not** run the tests — which is exactly why CI runs the `test` target as its
own step before building the image it pushes.

The gateway has no runtime suite yet, so its gate is a full typecheck of both
workspaces against the installed tree. That catches what this image is most
exposed to: contracts and gateway drifting apart.

## Contracts now emits JavaScript

`@alltheway/contracts` previously shipped TypeScript source (`main:
./src/index.ts`, `noEmit: true`), which worked only because every consumer —
Vite, tsx — compiles TS on the fly. Distroless carries a node binary and nothing
else: no npm, no shell, no TypeScript loader.

So contracts and gateway each gained a `tsconfig.build.json` that overrides
`noEmit` and emits to `dist/`. The base configs are untouched, so editors and
`npm run typecheck` behave exactly as before. A root `postinstall` builds
contracts, so a fresh clone still works without anyone remembering a step.

Shipping sources plus `tsx` was the alternative, and it would have meant
compiling TypeScript on every Cloud Run cold start.

## Three bugs a clean image build found

None of these were visible locally, because the dev machine had everything
installed globally and nothing ever started from scratch.

1. **`watcher-runtime` imported `a2a.client` without declaring `a2a-sdk`.** It
   worked only because the package was installed system-wide.
2. **`a2a-sdk` alone is not enough to serve.** The JSON-RPC server path imports
   `sse_starlette`, which arrives with the `[fastapi]` extra. Bare `a2a-sdk`
   built fine and the container died at start.
3. **`PUBLIC_URL` is load-bearing.** An A2A client fetches the callee's card and
   then talks to the URL *the card advertises* — not the one it was handed. A
   card built without `PUBLIC_URL` advertises `http://localhost:8090`, so every
   caller dials itself. Found by running the built gateway image against the
   orchestrator; no unit test can see it.

## Terraform owns the shape, CI owns the image

The deploy step passes `--image` and nothing else. `--set-env-vars` or
`--ingress` there would silently overwrite what Terraform declared, and the next
`apply` would not restore it — the module's `lifecycle { ignore_changes = [image] }`
only protects the image.

So the peer wiring lives in Terraform, next to the IAM that permits it:

| service | knows about |
|---|---|
| gateway | `ORCHESTRATOR_URL`, `WEB_ORIGINS` |
| orchestrator | `RESEARCH_CELL_URL` |
| watcher-runtime | `ORCHESTRATOR_URL` |

plus `PUBLIC_URL` for every service, computed from Cloud Run's deterministic
`https://{service}-{env}-{project_number}.{region}.run.app` form. Using each
service's own `uri` output would be circular — a service cannot reference its
own URL while being created, and its callers need it up front.

This sits deliberately beside `invoker_graph`: a service that may call another
but does not know where it is, is as broken as one that knows and may not.

## Image sizes

| image | size |
|---|---|
| orchestrator | 198 MB |
| research-cell | 198 MB |
| profile-synthesizer | 219 MB |
| watcher-runtime | 231 MB |
| gateway | 617 MB |

The gateway is large because `firebase-admin` and `@google-cloud/pubsub` bring
gRPC and its native binaries. Worth revisiting if cold starts suffer; not worth
bundling gymnastics before there is evidence.
