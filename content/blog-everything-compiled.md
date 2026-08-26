---
title: "Everything Compiled. That Was the Problem."
subtitle: "Nine bugs from building an agentic platform on Google Cloud — none of which a typechecker could see"
tags: [ai, googlecloud, agents, devops]
canonical_note: "Publish on dev.to or Medium. Public, not unlisted."
---

# Everything Compiled. That Was the Problem.

*I built **AllTheWay** — a collaborative AI companion that talks with you, watches and acts for you, and remembers how you work — on Google Cloud. Along the way I kept a list of every bug that made it to production or nearly did. Nine of them. Not one was catchable by a typechecker, a linter, or a passing test suite.*

*This piece was created for the purposes of entering the All Things Agentic Hackathon.*

---

There is a particular kind of bug you only meet when you build agents.

It is not a type error. Your CI is green. Your tests pass — all 300 of them. The container builds, the deploy succeeds, the health check goes green, and the thing is completely broken in a way that will take you two days and a production incident to notice.

I hit nine of these. Here they are, in the order they hurt.

## 1. Google's frontend eats `/healthz`

Every service had a health endpoint at `/healthz`. The smoke test called it. It returned Google's own 404 page.

The first instinct is that the route is wrong. It is not. The request **never reaches your container** — Google's frontend on `*.run.app` intercepts that exact path and answers it itself.

I proved it by absence: the probe's request appeared in *no* log, while `/api/sessions` from the same probe appeared immediately. A request that leaves no trace never arrived.

`/healthz/` — with a trailing slash — passes straight through.

There is a second trap inside the first. Express matches `/healthz/` to `/healthz` because strict routing is off, so a Node service is fine. **FastAPI answers `/healthz/` with a 307 redirect back to `/healthz`** — straight into the intercepted path. The workaround that fixes your Node service breaks silently on your Python ones.

The fix is to register both spellings explicitly on every service, so whoever writes the next probe cannot pick the wrong one.

## 2. A dev dependency stole the hoisted slot and the container exited

The gateway image built fine and then died at startup:

```
Error: Cannot find package 'ws' imported from /repo/services/gateway/dist/voice/relay.js
```

`ws` was in `dependencies`. The lockfile had it. It installed locally.

Here is what actually happened. `firebase-tools` — a **dev** dependency — depends on `ws@7`. npm hoisted that to the root `node_modules/ws`. My gateway needed `ws@8`, an incompatible major, so npm nested it at `services/gateway/node_modules/ws`.

Then `npm prune --omit=dev` deleted the root `ws@7` as a dev package. And my Dockerfile copied `/repo/node_modules` — but never `/repo/services/gateway/node_modules`.

Four packages were being silently dropped. `ws` just happened to be imported first.

I reproduced it without Docker by recreating the module layout in a temp directory: before the fix, `Cannot find package 'ws'`; after, `resolved ws`. Same error, verbatim.

**The lesson:** in a workspace monorepo, "which `node_modules` does my image actually contain" is a question with a non-obvious answer.

## 3. The trigger didn't watch the library

I rewrote a shared screening library, pushed, and no build ran.

The Cloud Build triggers used `included_files = ["services/<name>/**"]`. The library lives in `libs/screening` and is **copied into** several service images. A change there changes the image and fires nothing.

This one was worse than a missed build. Terraform had *simultaneously* pointed those services at a real Model Armor template — so production was running the **old** code, which raised `NotImplementedError` on that path, against a config that now expected the new code. Fail-closed turned it into an outage rather than a hole, but nothing announced it.

Path filters must include the shared code an image bakes in. I made them deliberately over-broad: any `libs/**` change now rebuilds every backend service. Rebuilding an image that didn't need it costs minutes. *Not* rebuilding one that did means a service running code nobody shipped.

## 4. The model doesn't exist where your other models live

Voice was wired, tested, deployed. It failed 100% of the time.

`GOOGLE_CLOUD_LOCATION` was `global` — correct for text generation, where the current Gemini Flash models live. The Live API model is not there:

```
global        1008 Publisher model .../locations/global/... was not found
europe-west1  setupComplete
europe-west4  setupComplete
us-central1   setupComplete
```

The unit tests passed because they asserted the *URL* for `global` isn't location-prefixed — which is true. The URL was perfect. The model wasn't there.

**One environment variable is not one setting.** Text generation and the Live API needed different regions, and collapsing them into `GOOGLE_CLOUD_LOCATION` guaranteed one would be wrong.

## 5. WebSockets do not survive Firebase Hosting

The browser opened its voice socket at the site's own origin. Through Firebase Hosting:

```
via Firebase Hosting: ERROR 401, no upgrade
direct to Cloud Run:  UPGRADED, relay replied {"error":"unauthenticated"}, closed 4001
```

The relay was live and correct the whole time. Hosting simply cannot carry a WebSocket upgrade.

I already knew Hosting applies an unconfigurable 60-second timeout to rewrites, and had written a decision record about serving the stream from Cloud Run's own hostname instead. The mitigation existed. The environment variable that switches it on was never set in CI — so the bundle silently fell back to the Hosting origin and the entire decision record was inert.

**A documented mitigation that nothing enables is just a document.**

## 6. Sign what you actually serve

AgentCards are authoritative: an A2A client fetches your card and then talks to the URL *the card* advertises. So a card needs a signature, or anything that can answer a card fetch can redirect your agent's traffic.

The trap is in what you sign. The card is a protobuf; the route serialises it to camelCase JSON with empty fields omitted. Sign a hand-built dict — or a snake_case one — and you get a signature that verifies against a document nobody ever sends. It passes its own tests perfectly and fails against every real client.

I checked byte-for-byte that `MessageToDict(card)` equals what the endpoint actually returns *before* signing anything. Then:

```
signed on serve: True | verify: ok | Card signature verified
after URL swap : invalid
```

Also worth knowing: JWS wants the ECDSA signature as fixed-width `R||S`, not the DER your crypto library hands you. Get that wrong and it verifies with your code and nothing else — the worst kind of working.

## 7. "Nothing found" is not "nothing there"

Model Armor screens for prompt injection. Its response has a per-filter `matchState` — and, separately, a per-filter `executionState`.

A partially degraded call, where some filters didn't run, looks **identical to a clean pass** unless you check the second field. Every `matchState` says `NO_MATCH_FOUND`, because a filter that didn't execute found nothing.

A filter that did not run has found nothing, and "found nothing" must never be read as "nothing there". The screener now raises on any non-`EXECUTION_SUCCESS` state, and the template sets `ignore_partial_invocation_failures = false` so the service agrees rather than relying on the client to notice.

## 8. The model forgets to say the dangerous part

This one is my favourite, because it is not an infrastructure bug at all.

The product has a confirm gate: before anything irreversible, it stops and asks. The gate reads an `action` field the planning model fills in.

Measured against real prompts — "pay the outstanding invoice", "delete the draft and send the final" — the model marked the irreversible step in only **8 of 12 runs**. A third of the time the plan came back with nothing flagged, so the gate never fired and the user was never asked.

Switching models didn't help; two were identical on it.

So I stopped trusting the label. A validation pass re-derives severity from the step's own wording and **escalates only, never downgrades**. That asymmetry is the whole safety argument: a model that under-labels gets corrected, while neither a model nor text injected into a plan can talk the gate *out* of firing.

Re-running the measurement against live Gemini afterwards:

```
turns that produced a plan          : 5/15   (the other 10 correctly asked a clarifying question)
plans that stopped for confirmation : 5/5
plans validation had to correct     : 5/5
```

Every single plan needed correcting. Without the validation pass, every one of those turns would have proceeded without asking.

## 9. I probed a video model and it billed me

Right at the end, checking which Veo models were available, I sent a valid payload to `:predictLongRunning`.

That endpoint does not report on a model. It **starts a generation**. Two ran before I intended them to, at roughly $6 each.

The correct probe uses a deliberately invalid payload, so a live model answers `400` — *it exists, and it refused* — instead of `200`, *it exists, and is now billing you*:

```
veo-3.1-generate-001       400  exists, nothing generated
veo-3.1-fast-generate-001  400  exists, nothing generated
veo-3.1-lite-generate-001  400  exists, nothing generated
veo-2.0-generate-001       404  absent
```

**Probing a generative endpoint is not a read.**

---

## The pattern

Look at what these have in common.

Every one lives at a **boundary**: between your code and a platform's frontend, a package manager's hoisting, a CI path filter, a region, a protocol upgrade, a serialiser, an API's error semantics, a model's judgment, a billing meter.

Agentic systems are almost entirely boundaries. An agent is a thing that calls other things — models, tools, other agents, someone else's API. The interesting failures are never inside a function you wrote. They are in the space between two systems that each believe they are behaving correctly.

Which is why the discipline that actually worked was embarrassingly simple:

**Verify by running.** Not by typechecking. Not by reading the docs — one of these bugs came *from* the docs; Google's own Cloud blog gives a model id that 404s while the dotted variant returns 200. Not by a green test suite, because a test asserting the URL shape for `global` passed while the model wasn't there.

By making the actual call, against the actual project, and looking at what actually came back.

Everything compiled. That was the problem.

---

*AllTheWay is built on Cloud Run, Vertex AI, Firestore and Firebase, using the A2A protocol between agents and MCP out to tools, with Model Armor screening untrusted content and signed AgentCards so a card cannot be spoofed.*

*This piece was created for the purposes of entering the All Things Agentic Hackathon.*

*#AllThingsAgenticHackathon*
