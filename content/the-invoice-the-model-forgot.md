---
title: "The model would have paid the invoice"
subtitle: "Nine production bugs from building AllTheWay on Google Cloud, none of which a typechecker could see"
tags: [ai, googlecloud, agents, devops]
canonical_note: "Publish on dev.to or Medium. Public, not unlisted."
---

# The model would have paid the invoice

I told a planning model to pay an outstanding invoice. A third of the time it wrote a clear, grammatical plan and never marked the step as something that would move money. My confirm gate reads that mark. If the mark is missing, nobody gets asked, and the turn proceeds.

I measured it. Real prompts, live Gemini: "pay the outstanding invoice", "delete the draft and send the final". The model labelled the irreversible step in 8 of 12 runs. Switching models did nothing. Two of them were identical on it.

CI was green. The container was healthy. Tests passed, hundreds of them. The dangerous part was a field a model sometimes declines to fill in.

I built AllTheWay for the All Things Agentic Hackathon: a companion you talk to, that watches and acts for you, and that learns how you work from your corrections. Nine Cloud Run services, one GCP project, A2A between agents, MCP out to tools. I kept a list of every failure that reached production or nearly did. Nine of them. None of them showed up as a type error, a lint, or a failing suite.

This piece was created for the purposes of entering the All Things Agentic Hackathon.

## Google answered the health check itself

Every service had `/healthz`. The smoke test called it and got Google's own 404 page.

The first guess is a wrong route. The request never reaches the container. Google's frontend on `*.run.app` intercepts that exact path and answers it.

I proved it by absence. The probe's request appeared in no log. `/api/sessions` from the same probe appeared immediately. A request that leaves no trace never arrived.

`/healthz/` (trailing slash) passes through.

Then the second trap. Express maps `/healthz/` onto `/healthz` because strict routing is off, so a Node service is fine. FastAPI answers `/healthz/` with a 307 back to `/healthz`, which is the intercepted path. The workaround that saves Node breaks Python.

Register both spellings on every service, so the next probe cannot pick the wrong one.

## A dev dependency stole `ws` and the container exited

The gateway image built. Then it died:

```
Error: Cannot find package 'ws' imported from /repo/services/gateway/dist/voice/relay.js
```

`ws` was in `dependencies`. The lockfile had it. It installed on my laptop.

`firebase-tools` is a dev dependency. It wants `ws@7`. npm hoisted that to the root `node_modules/ws`. The gateway needs `ws@8`, an incompatible major, so npm nested the real one at `services/gateway/node_modules/ws`.

`npm prune --omit=dev` deleted the root `ws@7` as a dev package. The Dockerfile copied `/repo/node_modules` and never copied `/repo/services/gateway/node_modules`.

Four packages were being dropped. `ws` was just the first import.

I reproduced it without Docker by rebuilding the module layout in a temp directory. Before the fix: `Cannot find package 'ws'`. After: `resolved ws`. Same error, verbatim.

In a workspace monorepo, "which `node_modules` does this image actually contain" is not an obvious question.

## I rewrote a library and nothing rebuilt

I changed a shared screening library, pushed, and no Cloud Build ran.

The triggers used `included_files = ["services/<name>/**"]`. The library lives in `libs/screening` and is copied into several images. A change there changes the image and fires nothing.

Terraform had also pointed those services at a real Model Armor template. Production was still running the old code, which raised `NotImplementedError` on that path, against a config that expected the new code. Fail closed turned it into an outage rather than a hole. Nothing announced it.

Path filters have to include the shared code an image bakes in. Any `libs/**` change now rebuilds every backend service. Rebuilding an image that did not need it costs minutes. Not rebuilding one that did means a service running code nobody shipped.

## The Live model is not in `global`

Voice was wired, tested, deployed. It failed every time.

`GOOGLE_CLOUD_LOCATION` was `global`. That is correct for text generation, where the current Gemini Flash models live. The Live API model is not there:

```
global        1008 Publisher model .../locations/global/... was not found
europe-west1  setupComplete
europe-west4  setupComplete
us-central1   setupComplete
```

The unit tests passed because they asserted that the URL for `global` is not location-prefixed. True. The URL was perfect. The model was not there.

Text generation and the Live API needed different regions. One environment variable guaranteeing one of them would be wrong.

## Firebase Hosting cannot carry a WebSocket

The browser opened the voice socket at the site's own origin. Through Firebase Hosting:

```
via Firebase Hosting: ERROR 401, no upgrade
direct to Cloud Run:  UPGRADED, relay replied {"error":"unauthenticated"}, closed 4001
```

The relay was live. Hosting cannot carry a WebSocket upgrade.

I already knew Hosting applies a 60-second timeout to rewrites that you cannot turn off. I had written a decision record about serving the stream from Cloud Run's own hostname. The environment variable that switches it on was never set in CI, so the bundle fell back to the Hosting origin and the decision record did nothing.

A mitigation that nothing enables is a document.

## Sign the bytes you actually serve

AgentCards are how A2A clients find you. A client fetches your card and talks to the URL the card advertises. If the card is unsigned, anything that can answer a card fetch can redirect your agent's traffic.

The trap is what you sign. The card is a protobuf. The route serialises it to camelCase JSON with empty fields omitted. Sign a hand-built dict, or a snake_case one, and you get a signature that verifies against a document nobody ever sends. It passes its own tests and fails against every real client.

I checked byte for byte that `MessageToDict(card)` equals what the endpoint returns, then signed that. Then:

```
signed on serve: True | verify: ok | Card signature verified
after URL swap : invalid
```

JWS also wants the ECDSA signature as fixed-width `R||S`, not the DER your crypto library hands you. Get that wrong and it verifies with your code and nothing else, which is the worst kind of working.

## "Nothing found" is not "nothing there"

Model Armor screens untrusted content for prompt injection. The response has a per-filter `matchState` and, separately, a per-filter `executionState`.

A call where some filters did not run looks identical to a clean pass unless you check the second field. Every `matchState` says `NO_MATCH_FOUND`, because a filter that did not execute found nothing.

A filter that did not run has found nothing. "Found nothing" must never be read as "nothing there". The screener now raises on any state other than `EXECUTION_SUCCESS`. The template sets `ignore_partial_invocation_failures = false` so the service agrees instead of relying on the client to notice.

## The gate that didn't fire

This is the invoice again.

The product stops before anything irreversible and asks. The gate reads an `action` field the planning model fills in. A prompt instruction to "always label irreversible steps" is advice. The model complies most of the time, and the times it does not are exactly the times you needed it.

So I stopped trusting the label. A validation pass re-derives severity from the step's own wording and escalates only. It never downgrades. A model that under-labels gets corrected. Injected text in a plan cannot talk the gate out of firing.

Re-running the measurement against live Gemini afterwards:

```
turns that produced a plan          : 5/15   (the other 10 correctly asked a clarifying question)
plans that stopped for confirmation : 5/5
plans validation had to correct     : 5/5
```

Every plan needed correcting. Without that pass, every one of those turns would have proceeded without asking. You cannot treat the safety property as a field the model is asked to set.

## I probed Veo and it billed me

Near the end I checked which Veo models were available. I sent a valid payload to `:predictLongRunning`.

That endpoint does not report on a model. It starts a generation. Two ran before I meant them to, at about $6 each.

The probe that does not cost money uses a deliberately invalid payload. A live model answers `400` (it exists, and it refused) instead of `200` (it exists, and it is now billing you):

```
veo-3.1-generate-001       400  exists, nothing generated
veo-3.1-fast-generate-001  400  exists, nothing generated
veo-3.1-lite-generate-001  400  exists, nothing generated
veo-2.0-generate-001       404  absent
```

Probing a generative endpoint is not a read.

## What they share

Every one of these sits between two systems that each thought they were behaving correctly. Google's frontend and my health check. npm's hoisting and my Dockerfile. A path filter and a library copied into an image. `global` and a Live model that does not live there. Firebase Hosting and a WebSocket upgrade. A protobuf and the JSON a client actually GETs. `matchState` and `executionState`. A model's `action` field and a gate that believed it. `:predictLongRunning` and my idea of a probe.

An agent calls models, tools, and other agents. The interesting failures are not inside a function I wrote.

The habit that caught them was dull. Make the call against the real project. Look at what came back. Not the docs (Google's own Cloud blog gives a model id that 404s, while the dotted variant returns 200). Not a green suite that asserted a URL shape while the model was missing.

AllTheWay runs on Cloud Run, Vertex AI, Firestore and Firebase. Agents talk A2A. Tools sit behind MCP. Model Armor screens untrusted content. AgentCards are signed on the bytes the endpoint serves.

This piece was created for the purposes of entering the All Things Agentic Hackathon.

#AllThingsAgenticHackathon
