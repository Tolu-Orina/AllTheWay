# AllTheWay — A2A & Platform Implementation Plan

**Status:** Phases 0–6 delivered (2026-08-26; Model Armor REST still pending) · Phases 7–9 proposed · **Date:** 2026-08-26 · **Project:** `alltheway-rinegan` (`678063096671`), org `conquerorfoundation.com`, europe-west1.

Covers the gap between what is built today and the Production Roadmap's phases 5–10, with **A2A at every internal boundary** as the load-bearing first phase.

---

## 0. Where we are

Bootstrap and the prod stack are applied. Both Terraform roots plan clean.

| Live in `alltheway-rinegan` | Still to do |
|---|---|
| 6 Cloud Run services on real images, Firestore `(default)` in europe-west1 | **A real turn in production — the orchestrator has never served a request** |
| Artifact Registry, GCS state bucket, 14 Cloud Build triggers | Model Armor REST call (Phase 6) |
| Firebase Hosting serving `alltheway.rinegansolutions.com`; real Firebase Auth, Google and email sign-in | A consenting user for the Google Calendar connector |
| Email delivery via Resend, from a verified domain | Server-side plan validation — action labelling is unreliable, see Phase 0 |
| Voice relay: Vertex Live over a gateway WebSocket, `europe-west1` | Companion panel still answers from local stubs |
| Least-privilege IAM per runtime identity | Agent Registry, monetization, multi-region (7–9) |
| `USE_VERTEX=true`, `gemini-3.7-flash` pinned and measured against the live API | |

**Deployed from CI:** all six services now run images built from `main`. The
placeholder image is gone.

**The critical deviation is closed.** Every internal call is A2A, and as of
Phase 1 item 1.4 every one carries a Google-signed identity token.

## Research basis

Findings that shaped the plan, verified against current sources:

- **A2A is at v0.3.x** (spec [a2a-protocol.org](https://a2a-protocol.org/latest/specification/)). Methods: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `GetExtendedAgentCard`, plus four push-notification-config methods. Clients must send an **`A2A-Version` header** for version negotiation.
- **Agent cards** live at `/.well-known/agent-card.json`, may be signed, and carry capabilities, skills, security schemes and supported interfaces.
- **Task states**: `TASK_STATE_SUBMITTED`, `WORKING`, `COMPLETED`, `FAILED`, `CANCELED`, `INPUT_REQUIRED`, `REJECTED`, `AUTH_REQUIRED`.
- **Streaming** is SSE, carrying `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` inside a `StreamResponse`.
- **Security schemes**: `APIKeySecurityScheme`, `HTTPAuthSecurityScheme`, `OAuth2SecurityScheme`, `OpenIdConnectSecurityScheme`, `MutualTlsSecurityScheme`.
- **ADK exposes agents** with `to_a2a(root_agent, port=…)` from `google.adk.a2a.utils.agent_to_a2a`, which auto-generates the card and wires an `A2aAgentExecutor`, `InMemoryTaskStore` and a Starlette app. It consumes with `RemoteA2aAgent` + `AGENT_CARD_WELL_KNOWN_PATH` from `google.adk.agents.remote_a2a_agent`.
- **A JS SDK exists** — `@a2a-js/sdk`, official. **Resolved during Phase 1:** both SDKs are on the 1.x line — Python `a2a-sdk` 1.1.2, Node `@a2a-js/sdk` 1.0.1. No version skew. (The 0.3.x figure in earlier research was stale.)
- **Gemini Live API** is stateful over WebSocket, audio-to-audio, supports function calling. **Vertex does not issue ephemeral tokens**; the gateway relays the session. Native audio auto-detects language (no picker). See [decisions/0006](decisions/0006-voice-through-the-gateway.md).
- **Model Armor** is a REST service screening prompts/responses for prompt injection, jailbreak, PII (150+ types via Sensitive Data Protection) and malicious URLs. Model-agnostic; needs Cloud Logging enabled to see sanitisation results.

### The insight that shapes everything

**The Clarify Gate is `TASK_STATE_INPUT_REQUIRED`.** Our central product rule — never act on an ambiguous request, stop and ask — is already a first-class state in the A2A task lifecycle. Adopting A2A doesn't just satisfy the architecture doc; it makes the Clarify Gate expressible in the protocol instead of encoded in a bespoke `decision` field. Watchers pausing for review (FR-W3) is the same state, and `TASK_STATE_AUTH_REQUIRED` maps cleanly onto a connector needing consent.

---

## Phase 0 — Make it real — **DELIVERED**

Applied against `alltheway-rinegan`. Bootstrap: 111 resources, state migrated to
`gs://alltheway-rinegan-tfstate`. Prod stack: 34 resources. Both plan clean.

1. ✅ Config comes from Terraform, not `.env` — emulator hosts are absent in
   prod by construction rather than by remembering to unset them.
2. ✅ `infra/bootstrap` then `infra`, **prod** workspace (dev deferred; the user
   chose prod-via-`main` first).
3. ✅ `USE_VERTEX=true` and `GEMINI_MODEL=gemini-3.7-flash`, set in Terraform so
   the deployed value is reviewable rather than implicit in `providers.py`.
4. ✅ Firestore indexes as code — `firestore.indexes.json`, referenced from
   `firebase.json`, plus a TTL policy in Terraform.

### The model pin was measured, not assumed

Both candidates were run against this project before choosing. `gemini-2.0-flash`
**404s on the `global` endpoint**, so the pin is load-bearing rather than
decorative.

| | 3.6-flash | 3.7-flash |
|---|---|---|
| median latency (n=5) | 4802 ms | **3691 ms** |
| spread | 2923–7111 | **3311–5264** |
| schema validity | 5/5 | 5/5 |
| gate behaviour | correct | correct |

Pinned to **3.7-flash** on the tighter spread as much as the median: the max
drops from 7.1s to 5.3s, and the maximum is what someone watching a plan build
actually experiences.

### Two findings that outlive the model choice

**The real model does not stream incrementally.** Called the way the orchestrator
calls it, it emits the whole document in 3–4 chunks at the end — every plan step
was released within ~400ms of the others. Phase 2's machinery is correct and the
invariants hold, but the plan panel will sit empty and then fill at once rather
than filling in. `FAKE_STREAM_DELAY_MS` made the fake look like progressive
delivery that the real model does not provide.

**Action labelling is unreliable, and the confirm gate depends on it.** On
explicitly risky prompts ("pay the invoice", "delete the draft and send the
final"), *both* models marked an irreversible action in only **8 of 12 runs**. A
third of the time the plan comes back with nothing flagged, so FR-V2's gate does
not fire and the user is never asked.

This is not a model-selection problem — the two are identical on it — and it is
not fixed by switching. The layered design still holds at the point of effect:
the connector gateway classifies severity from its **own registry**, never from
the model, so an unlabelled step cannot execute unchecked. What is lost is the
*warning*, which is the part the user sees. Addressing it needs a validation
pass over the returned plan rather than trust in the model's own labelling.

### Item 4 as written would have broken email verification

The plan said a TTL on `authCodes.createdAt`. Firestore deletes a document *at
the time held in its TTL field* — and `createdAt` is always in the past, so every
verification code would have been deleted the instant it was written. The
symptom reads as "verification is broken", not "the TTL field is wrong".

Implemented on a new `expiresAt` field instead. The TTL is garbage collection,
not the security control: `verifyCode` still enforces the ten-minute window
itself, because TTL deletion is best-effort and can lag by hours.

### Two gaps that would have failed silently in production

**Runtime identities had no permissions.** Bootstrap grants a baseline (pull an
image, write logs and traces) and says the rest "belongs in envs/*" — where it
had never been written. Every service would have 403'd on its first real call:
no Vertex for the orchestrator, no Firestore for the gateway, no Secret Manager
for the connector gateway. Now derived per service from what its code actually
imports.

**Pub/Sub push could not deliver.** Two grants missing, both invisible until a
message is published: Pub/Sub's service agent could not mint a token as the
consumer's identity, and that identity was not in the consumer service's invoker
list — `invoker_graph` grants the orchestrator, but the caller here is the
consumer itself.

**Exit:** met for infrastructure and configuration. The end-to-end assertion — a
real Gemini plan rendering in `/app` — waits on the orchestrator deploying (its
directory has now changed) and on Hosting content.

## Phase 1 — A2A at every internal boundary — **DELIVERED**

**Goal:** every inter-agent call is A2A. No bespoke HTTP contracts between services.

### 1.1 Make the orchestrator a real ADK agent *(the largest single item)*

Today it is a pure function behind FastAPI. `to_a2a()` expects an ADK agent. Work:

- Model the graph as ADK composition: a `SequentialAgent` whose first node is the Clarify Gate (a `CustomAgent` the router cannot bypass, per architecture §Clarify Gate) and whose second is the planner.
- Keep `ModelProvider` **underneath** ADK, not replaced by it: `FakeProvider` must keep the whole graph runnable with zero credentials. This is what makes the 4 existing tests survive the migration, and they are the regression suite for it.
- Expose: `a2a_app = to_a2a(root_agent, port=8090)`, served by uvicorn.

### 1.2 Author agent cards deliberately

`to_a2a()` auto-generates a card. **Do not ship the generated one.** Hand-author `agent-card.json` per service and pass it in, because the card is a public contract:

- `orchestrator` — skills: `plan_session`, `clarify`. Declares `streaming: true`.
- `research-cell` — skill: `research_topic`. Declares bounded limits in its description.
- Cards are versioned and committed; a card change is a reviewable diff.

### 1.3 Gateway becomes an A2A client

- Add `@a2a-js/sdk` (version pinned per the research note above).
- Replace `services/gateway/src/orchestrator.ts` with an A2A client calling `SendMessage`.
- Map A2A task states to the wire contract the web app already knows:
  `INPUT_REQUIRED` → `decision: "clarify"`, `COMPLETED` → `decision: "plan"`, `FAILED`/`REJECTED` → typed `ApiError`.
  This keeps `services/contracts` stable, so **no web changes are needed in this phase**.

### 1.4 Authentication between agents — **DELIVERED (2026-08-25)**

Deferred through Phases 1–5 on the grounds that there was no real identity to
verify against. Once there was, it turned out not to be hardening at all: **no
A2A client attached any credential**, so every internal call in the deployed
system would have failed. Cloud Run rejects unauthenticated requests to
`INGRESS_TRAFFIC_INTERNAL_ONLY` services, and locally nothing required auth —
which is exactly why four phases passed without noticing.

> **Superseded (2026-08-27).** These services are no longer `INGRESS_TRAFFIC_INTERNAL_ONLY`. There is no VPC in this project, and Cloud Run rejects an ingress-blocked call with a *404* — so every gateway→service call was refused at the edge and `/api/registry/agents` returned 502 for thirty days without one success. Ingress is now `ALL` and reachability is gated by IAM: only the principals holding `roles/run.invoker` can call these services, and an anonymous request gets a 403. See `infra/modules/backend-service/main.tf`.


- **Gateway** (`src/a2a.ts`): a `fetchImpl` that mints an identity token per
  audience, passed to both the transport factory *and* the card resolver — the
  card fetch is a request to the same closed service and happens first.
- **Python** (`libs/agentauth`): shared by the orchestrator and the watcher
  runtime, so there is one auth path rather than two that drift.

**Verification is Cloud Run's, deliberately.** It checks signature, issuer and
audience and enforces IAM *before* the request reaches the container — stronger
than an in-process check, which a compromised process could skip. The card's
`HTTPAuthSecurityScheme` (bearer) is an honest description of that: the A2A
layer and the IAM layer agree rather than duplicating.

**It degrades rather than refusing.** With no token available the call goes out
unauthenticated — because on a laptop there is no metadata server and the local
services require nothing, while in production Cloud Run rejects it anyway.
Failing hard would defend a boundary the platform already defends, at the cost
of making the stack unrunnable offline.

The audience is the callee's base URL, so tokens are minted per target. One
global token would be rejected by every service except the one it was minted
for, and the failure would look like a permissions bug.

**Do not** use API keys. There is no key to leak in this architecture and adding one would create the first.

### 1.5 Watcher runtime becomes an A2A client

Replace its `httpx.post("/turn")` with the same A2A client path, so watcher runs and live sessions genuinely traverse identical machinery — which is the architecture's claim (§6) and currently only approximately true.

### Risks

- **ADK migration is the real cost here**, not A2A itself. Budget for the graph rewrite; the protocol work is comparatively mechanical.
- **Version skew** between `@a2a-js/sdk` and the Python `a2a` library. Pin both, and add a contract test that fetches each card and validates it against the spec's schema.

**Exit:** `curl` any agent's `/.well-known/agent-card.json` and get a valid card; gateway drives the orchestrator over JSON-RPC; all existing tests pass; `A2A-Version` sent on every call.

---

## Phase 2 — Streaming — **DELIVERED**

**Goal:** the Plan Panel fills in live instead of appearing at once. Met: the
panel goes 0 → 1 → 2 → 3 → 4 in a real browser under reduced motion
(`web/scripts/streaming.mjs`).

1. ✅ Orchestrator emits `TaskStatusUpdateEvent` per trace line and
   `TaskArtifactUpdateEvent` per plan step, appended onto one artifact.
2. ✅ Gateway relays SSE at `GET /api/sessions/:id/turn/stream`.
3. ✅ Web consumes it and appends steps as they arrive.

### What the risk check found

The plan said to verify SSE through Firebase Hosting **before** building on it.
Done first, and the answer was no: Hosting imposes a **documented, unconfigurable
60-second timeout on rewrites**, which severs a long-lived stream regardless of
buffering. The fallback became the design — the stream is served from the
gateway's own hostname. See
[decisions/0001](decisions/0001-sse-not-behind-firebase-hosting.md).

### Deviations from the plan as written

- **`fetch` + `ReadableStream`, not `EventSource`.** EventSource cannot set
  request headers, which would force the Firebase ID token into the query string
  — where it lands in history, proxy logs and `Referer`. It also auto-reconnects,
  which for a turn would silently re-run the plan.
- **No `decision` event on the wire.** Announcing "this is a plan" early means
  taking it back when the plan turns out to be empty and the gate asks a question
  instead. The verdict is implied by which terminal event lands.
- **Card 1.0.0 → 1.1.0**, `streaming: false → true`, flipped only once it was real.

### The bug worth remembering

Everything compiled, all 36 tests passed, and the stream still arrived in a
single burst at 1142ms. The graph is a synchronous generator, so consuming it
directly inside `async def execute` never yielded the event loop and nothing
reached the wire until the turn was over. Real Vertex streaming would have failed
identically — `generate_content_stream` blocks between chunks too.

Found only by adding `FAKE_STREAM_DELAY_MS` and *watching arrival times*. Fixed
in `app/aio.py`, which consumes the blocking iterator on a worker thread. The
graph stays synchronous on purpose: making it async would mean async providers,
an async fake and async tests, to solve a problem that exists at one boundary.

### Not done

**Browser-level resume after a disconnect.** The orchestrator supports it — drop
a reader mid-stream and the task completes anyway, retrievable by id with all
four steps intact (verified in `scripts/verify_streaming.py`). But the gateway
does not surface task ids to the browser, so the client cannot reconnect to a
turn in progress; it starts a new one. A turn is currently ~1s, so the machinery
would cost more than it saves. This becomes worth building when Phase 3's
Research Cell and Phase 5's voice turns make turns long.

---

## Phase 3 — Research Cell — **DELIVERED**

**Goal:** the bounded swarm, reachable only through A2A. Met: a research-shaped
request fans out to two workers, returns one synthesised artifact, shows the
fan-out in the trace, and survives losing a worker.

New service `services/research-cell` (port 8093), 33 tests. Orchestrator
delegates to it over A2A; 11 new orchestrator tests cover the routing.

### Deviation: no ADK

The plan named `ParallelAgent` and `RemoteA2aAgent`. `google-adk` 2.7.1 was
installed and read before deciding, and `ParallelAgent` carries a deprecation
notice — replaced by `Workflow`, which "cannot yet be used as an LlmAgent
sub-agent" and is not exported in that version. It also provides none of the
bounds this cell needs: no token accounting, and a raising sub-agent propagates
rather than degrading. Full reasoning, including what adopting it would have
cost, in [decisions/0002](decisions/0002-no-adk-for-the-research-cell.md).

Consequence: **nothing in this repo uses ADK**, and the unused `google-adk`
declaration has been removed from the orchestrator's optional dependencies.

### FR-10 is enforced three times

The type has no field for worker text; the executor emits exactly one artifact;
the card offers no skill that could address a worker. One edit cannot undo it.

### Two bugs the tests would not have found

**The synthesis had no time reserved.** A *hung* worker consumed the entire wall
clock, so a run that already held a good finding returned "could not turn them
into an answer". Fixed by splitting the deadline the same way the token budget
was already split — the fan-out cannot spend what synthesis needs. Found by
hanging a worker against a running service; every unit test at the time was too
fast to see it.

**The fake provider echoed its own prompt.** The synthesis prompt contains every
worker's finding, so a fake that parrots its input republishes worker text
through the one channel allowed to leave the cell. An FR-10 test passed against
a hand-written stub while the provider everything else runs on was leaking.

### Second planning pass

A plan written before the finding existed cannot reflect it, so a research turn
plans twice: once to decide clarity, once knowing what was found. Steps from the
first pass are **held back** until it is known whether the second will replace
them — streaming a step and then rewriting it would break Phase 2's invariant
that every event is final.

The gate still runs first, so an ambiguous request never spends a swarm's budget.

### Degradation, end to end

| failure | result |
|---|---|
| one worker raises | synthesised from 1 of 2, `degraded: true`, COMPLETED |
| one worker hangs | same, bounded by the wall clock |
| cell entirely down | orchestrator releases the first-pass plan, says so in the trace |

**Exit:** met. `services/research-cell/scripts/verify_cell.py healthy|degraded|hung`.

---

## Phase 4 — Ship it — **DELIVERED**

Five multi-stage images, all distroless and non-root, all building from the repo
root, each gated by a `test` target that fails the build. `npm run docker:build`
builds and tests every one locally, exactly as Cloud Build does.

| image | size | gate |
|---|---|---|
| gateway | 617 MB | typecheck of both workspaces |
| orchestrator | 198 MB | 47 tests |
| research-cell | 198 MB | 33 tests |
| profile-synthesizer | 219 MB | 5 tests |
| watcher-runtime | 231 MB | 22 tests |

Full reasoning in [decisions/0003](decisions/0003-service-images.md). The
bootstrap decisions taken while applying this live are recorded in
[decisions/0004](decisions/0004-org-policy-exemption-for-public-gateway.md)
and [decisions/0005](decisions/0005-service-to-service-identity.md).

### Corrections to the plan as written

- **Python is 3.11, not 3.13.** `distroless/python3-debian12` ships 3.11.2;
  wheels built on 3.13 carry `cp313` tags and fail at import, not at build.
- **One root `.dockerignore`, not one per service.** Docker reads the file at
  the *context* root, and the context must be the repo root because the gateway
  imports a sibling workspace. Per-service copies would be silently ignored.
- **The deploy step passes `--image` and nothing else.** Terraform owns ingress,
  env and identity; `--set-env-vars` there would overwrite what it declared and
  the next apply would not restore it.

### Four bugs a clean build found

None were visible locally, because the dev machine had everything installed and
nothing ever started from scratch.

1. `watcher-runtime` imported `a2a.client` without declaring `a2a-sdk`.
2. `a2a-sdk` alone cannot serve — the JSON-RPC path needs `sse_starlette`, which
   comes with the `[fastapi]` extra. Built fine; died at container start.
3. **`PUBLIC_URL` is load-bearing.** An A2A client talks to the URL the *card*
   advertises, not the one it was handed. Without it every caller dials
   `localhost` and gets ECONNREFUSED. Now set by Terraform for every service.
4. **Nothing wired the services together.** `ORCHESTRATOR_URL`,
   `RESEARCH_CELL_URL` and `WEB_ORIGINS` were never set, so a deploy would have
   produced services that could not find each other. Now derived in Terraform
   from Cloud Run's deterministic URL form, beside the `invoker_graph` that
   grants permission to make those same calls.

Also fixed: the gateway refused to *boot* without a production mailer, taking
sessions, watchers and turns down with it — and failing the smoke check on
`/healthz` for a reason unrelated to health. It now refuses to **send**, which
preserves the rule (never log a code in production) without the blast radius.

### Verified

- All five images build, gate on tests, run non-root, and serve `/healthz`.
- A deliberately failing test stopped the build with exit 1.
- **Container-to-container A2A**: gateway, orchestrator and research-cell as
  three separate containers on a Docker network, with card discovery and
  research delegation working across them — the deployment topology, not a
  simulation of it.

### Deploy, proven (2026-08-25)

A push to `main` fired 3 of 7 triggers — only the services whose directories
changed, which is `included_files` working rather than a failure — and each ran
`test → build → push → deploy` green. `gateway`, `watcher-runtime` and
`connector-gateway` now run images tagged with the commit SHA.

**Cloud Build is 2nd-gen, not 1st.** The legacy `github {}` block needs a
"repository mapping" the current console no longer reliably creates; connecting
the repo left no mapping and all 14 triggers failed with
`Repository mapping does not exist`. Migrated to
`google_cloudbuildv2_connection` + `repository`, which makes the connection a
Terraform resource instead of a console step someone has to remember.

### The smoke step was wrong twice

It failed on every build, *after* a successful deploy:

1. **`gcloud auth print-identity-token` does not work in Cloud Build.** The
   build runs as a service account whose ID tokens come from the metadata server
   and need an audience; there is no user credential to mint from.
2. **An HTTP probe could not have worked anyway.** Five of six services are
   internal-only and the default build pool is outside the VPC, so the probe
   would fail on services that deployed perfectly.

Rewritten to assert the revision reached Ready and serves all traffic — which
Cloud Run only grants after the container starts and passes its probe — and to
make the HTTP call only for the public gateway.

### Google's frontend swallows `/healthz`

`GET /healthz` on `*.run.app` returns Google's 404 page and **never reaches the
container** (proven: the request appears in no log, while `/api/sessions` from
the same probe does). `/healthz/` with a trailing slash returns `{"ok":true}`.

This matters because `/healthz` is the health path on all six services. Nothing
in the platform announces it.

---

## Phase 5 — Voice — **DELIVERED (gates + gateway Live relay)**

**Goal:** talk to it; it confirms before acting. The two rules that make speech
different from typing are done, tested and verified in a browser. The audio
transport is a gateway WebSocket relay to Vertex Live (native audio), not a
browser-to-Google token. See [decisions/0006](decisions/0006-voice-through-the-gateway.md).

### The insight

**The confirm-summary gate is the Clarify Gate.** Both stop a turn and need
something from the user before anything happens, and both are
`TASK_STATE_INPUT_REQUIRED` on the wire. So FR-V2 needed **no new skill and no
new protocol state** — only a second reason for a state that already existed,
and an artifact saying which reason. A conformant A2A client stops correctly
without knowing what AllTheWay is.

| | |
|---|---|
| `clarification` artifact | "I do not understand you" |
| `confirmation` artifact | "I understand you, and not without a yes" |

### The policy is shared, not copied

Item 4 said reuse the policy code. `policy.py` lived inside `watcher-runtime`,
so it moved to **`libs/policy`** (`alltheway_policy`), imported by both the
watcher runtime (FR-W4) and the orchestrator (FR-V2). It stays a library rather
than becoming a service on purpose: a pure function behind a network call would
be unavailable exactly when the network is degraded, which is when you least
want an action proceeding unchecked. 17 tests moved with it.

### Confidence is two bars, not one

A single cutoff treats "draft me a note" and "wire the deposit" as equal risk.

| band | behaviour |
|---|---|
| < 0.55 | reject — stop **before the model is called**, ask for it in text |
| 0.55–0.80 | plan, but quote the transcript back before acting (FR-V4) |
| ≥ 0.80 | proceed as a typed turn |
| irreversible | needs ≥ 0.92 **regardless of ceiling** — permission to act is not permission to guess |

### The gate applies to typed turns too

FR-V2 sits under Voice, but the architecture is explicit that both modalities run
one graph, and a typed instruction that sends an email is exactly as
irreversible as a spoken one. So the gate keys on consequences, not microphones.

### Three bugs worth recording

1. **Steps were released on their label alone.** A repaired `{"label":"Email Ana"`
   is a valid object whose `action` has not arrived, so every side-effecting step
   reached the client marked harmless while the gate — reading the graph
   directly — still fired. Fixed by inferring completeness from position: once
   element *i+1* exists, element *i* is finished. String steps could not do this;
   the bug arrived with objects.
2. **`action` was dropped at the A2A boundary**, so the UI could not warn before
   approval even though the server was correct.
3. **The UI said "recorded" before the write landed.** A small lie that becomes a
   large one exactly when the network fails and a refusal does not stick.

### Verified in a browser

`npm run test:confirm` — a harmless plan is not gated; a sending plan stops; the
summary says what will happen and why; there is a visible way to refuse; the
sending step is badged in the plan itself; declining posts 201, says nothing was
done, and reaches the Feedback Ledger as `declined`.

### Items 1 and 2 — gateway relay (2026-08-26)

Tested against the real project on 2026-08-25:

```
client.auth_tokens.create()
  -> "This method is only supported in the Gemini Developer client."
```

**Vertex does not issue ephemeral Live API tokens.** They exist for the Gemini
Developer API, which authenticates with an AI Studio key — explicitly ruled out
for this product. So "the gateway mints a short-lived Live API token, the
browser opens a WebSocket to Google" has no implementation on our stack.

The architecture already prescribed the alternative (§3.8). Settled as
[decisions/0006](decisions/0006-voice-through-the-gateway.md): the gateway
holds the Vertex session; the browser talks only to us, over PCM
(AudioWorklet, 16 kHz in / 24 kHz out), `gemini-live-2.5-flash-native-audio`;
session resumption on `goAway`; no language picker (native audio auto-detects;
Igbo is absent). LiveKit is out unless PSTN or multi-party arrives.

`POST /api/voice/token` and `VertexTokenMinter` are gone. A mint that cannot
succeed is not a feature. Function calls from Live (`plan_turn`) run the same
orchestrator graph over A2A, so the confirm gate still sits in front of
anything that would change the world.

**Item 3** (single Orchestrator context) is satisfied by construction: the
orchestrator delegates research as a Plan Panel step rather than mid-turn,
which is exactly what the constraint requires.

---

## Phase 6 — Connectors, MCP & Model Armor — **DELIVERED (Model Armor pending a project)**

**Exit criterion met.** The plan said to write that test first, so it was written
before any screening existed and watched to fail — including
`test_a_blocked_run_never_acts`, which returned `awaiting_review` because the
injected payload genuinely reached the model.

Live, against a running watcher runtime:

```
injected email  -> blocked
   reason: Screening blocked this inbound content: possible prompt injection
           (concealment, exfiltration, instruction override, role reassignment)
ordinary email  -> awaiting_review
   trace: Screened inbound content: nothing flagged
          Screened outbound content: nothing flagged
          Ceiling requires your review first
```

### Screening (item 3)

`libs/screening`, shared and **fail-closed**: an unconfigured, unreachable or
raising screener returns *blocked*, not *allowed*. Middleware conventionally
fails open, which would make an attacker's first move "break screening".

Screened in **both directions** and at **three boundaries** — the watcher
trigger, what the model produced from it, and whatever a connector returns. That
last one matters: an attacker who cannot reach your inbox may still put a line
in a shared calendar event.

Findings never quote the payload. A trace that repeats an injection is read by a
user and summarised by a model later — the block becomes a second delivery route.

`ModelArmorScreener` deliberately raises rather than approximating the REST call.
`HeuristicScreener` is a real layer and honest about being pattern matching: it
catches known phrasings and will miss a paraphrase. It is a floor, not a
substitute, and the tests include ordinary sentences that *contain* injection
vocabulary ("ignore my earlier email", "forward the agenda") because a screen
everyone disables protects nobody.

### The Agent Gateway (items 1 and 2)

New service `services/connector-gateway` (port 8094): A2A inward, **MCP
outward**, with a real MCP calendar server launched as a subprocess. 38 tests,
none of the MCP path stubbed.

| outcome | A2A state |
|---|---|
| allowed | `COMPLETED` |
| needs a human | `INPUT_REQUIRED` |
| out of scope / rate limited / unregistered | `REJECTED` |

**It re-checks what the orchestrator already checked.** The confirm gate runs
where the plan is made; this runs where the effect happens. An irreversible call
arriving without confirmation is refused even at the highest ceiling — so a
compromised or skipped orchestrator does not turn into a side effect.

Tool severity lives in the gateway's registry, not in the connector: a connector
describing its own blast radius can understate it. Unregistered tools are
refused.

### Secrets (item 4)

`app/secrets.py`: fetched by name at the moment of use, cached for minutes so a
rotation lands without a deploy, and **never** falling back to an environment
variable — a fallback path is the path an attacker arranges to be taken. Even
the development source reads a file, so the dev path has the same shape and the
same failure modes as the real one.

### Three bugs worth recording

1. **Reads were being judged by the autonomy floor**, so `list_events` was
   refused under a `draft_only` ceiling. The floor governs *effects*; a read has
   none. Caught by a test asserting the product still works.
2. **The connector subprocess inherited no `PYTHONPATH`.** Stripping its
   environment is right, but that also removed how the interpreter finds its own
   modules. Worked locally (site-packages), failed in the image (`/deps`).
3. **`mcp` was unpinned.** The same manifest resolved 1.26 locally and 2.1.0 in
   the image, where the server API is restructured. Pinned to `<2` — the
   "pinned, never latest" discipline applied to models and forgotten here.

### Not done — needs the GCP project

- **Model Armor itself.** The screening seam, the fail-closed behaviour and the
  halt-and-trace path are built and verified; the REST call is not written.
- **Cloud Logging of sanitisation results** follows the same boundary.
- A **real** calendar connector needs OAuth and a consenting user. The in-memory
  server proves discovery, refusal, execution and screening; swapping it changes
  nothing above it.

---

## Phase 7 — Agent Registry & governance — **DELIVERED**

**Goal:** discovery and audit, at scale. The registry is a catalogue of
AgentCards, which is why Phase 1's decision to hand-author and commit them pays
off twice.

### Card signing, and why an authoritative card must be attested

An A2A client talks to the URL the *card* advertises, not the one it was handed
— Phase 4 proved that when a card built without `PUBLIC_URL` sent every caller
to `localhost`. Authoritative and unauthenticated is a bad combination: anything
that can answer a card fetch can redirect an agent's traffic, rename its skills,
or declare a weaker security scheme.

`libs/agentcards` signs a detached JWS (ES256) over canonical JSON with the
`signatures` field excluded. Verified against the real route before being
trusted: the signature covers `MessageToDict(card)`, which was checked
byte-for-byte against what the endpoint actually serves. Signing a hand-built
dict would have produced a signature that verifies with our code and nothing
else.

Live in production — all three agents log `agent card signed` at boot.

### The registry is a service, not a static list

It fetches every agent's card over authenticated HTTP and verifies it *now*,
because a catalogue saying an agent was trustworthy five minutes ago answers a
question nobody asked. It reports and never routes: an unverified card is
information about a problem, not a thing to act on.

`UNSIGNED` is not treated as a lesser failure than `INVALID`. Both mean the
contents are unattested, and "we could not check" must never read as "it is
fine".

Given the public key and never the private one — a registry that could sign
could manufacture a trusted entry for an agent nobody deployed.

### Per-org policy composes downward only

The effective ceiling is the **lower** of what the user granted and what the org
permits. An org policy that could raise a ceiling would hand an agent more
autonomy than the person it acts for agreed to, which inverts consent rather
than governing it.

A waiver now needs an org that permits waivers — **a deliberate tightening**.
Previously a valid `Waiver` was sufficient; a missing org policy is now the
strictest state, not the loosest, because a missing row is the most likely thing
during an outage. Every use is written to `waiverAudit` **before** the call
proceeds: a waiver recorded on success is a record of the calls that worked,
which is exactly the set nobody needs.

### Attribution

Every connector call opens its trace with the card version that handled it, so
an action is attributable to a published contract rather than to "the system".

**Exit:** met. A new agent is discoverable by adding it to the roster, and its
card is verified on every read.

---

## Phase 8 — Monetization — **DELIVERED**

Metered on the two dimensions with real marginal cost: **voice minutes** and
**watcher runs**. Not turns or messages — those are cheap, and metering them
would punish ordinary use while missing the expensive cases. A voice minute
holds a WebSocket open, pins an instance and streams audio through a model; a
watcher run is an unattended turn plus whatever connector calls it makes.

Connector calls are counted too, though not billed: a connector call is the
thing that reaches someone else's API, and an unbounded one is an abuse surface
even when it is cheap.

| | Free | Plus | Team |
|---|---|---|---|
| price | £0 | **£18/mo** | £32/seat |
| voice minutes | 30 | 600 | unmetered |
| watcher runs | 50 | 1000 | unmetered |
| connector calls | 200 | 5000 | unmetered |

### Enforced where the effect happens

In the Agent Gateway, beside the autonomy floor and connector scope — not in a
billing service the acting path could route around. `invoke()` takes a *store*,
never a tier: a caller that could state its own plan could grant itself an
upgrade, and there is a test asserting the parameter does not exist.

### The failure directions are chosen, not inherited

- An unrecognised tier resolves to **Free**. A corrupted subscription record
  must never become an upgrade.
- An unreadable subscription is Free, never unmetered — an outage that resolved
  everyone to Team would be an outage that also gave the product away.
- Usage is counted **after** success. Charging for refused calls would let a
  caller exhaust its own allowance by being denied.
- A lost count does not fail completed work, but is logged as an error: a meter
  that silently stops counting is a billing problem nobody notices.

### Visible before it binds

`GET /api/usage` reports where a user stands, and the trace warns at 80%. Someone
told "you have three runs left" can act; someone who discovers the limit by being
refused cannot.

Voice minutes are metered in the relay, because the gateway is the only process
that can observe how long a session lasted — asking the browser would mean
trusting a client to report its own consumption. Measured from the point the
session became usable, so nobody pays for a Vertex session that never opened.

### The payment provider is deliberately not wired

**Deferred 2026-08-26, pending product validation.** A tier is a Firestore value
today: `subscriptions/{uid}.tier` is set by hand, and everything downstream —
allowances, enforcement, the usage view — behaves exactly as it will when a
provider writes that field instead.

This is a deferral, not a gap, and the ordering is deliberate. Wiring Stripe
before the plan shape is validated would mean building webhooks, a customer
record, proration and dunning against limits that may still change — and every
one of those is expensive to change *after* real money has moved through it.

What it costs to defer: nothing can be sold. What it buys: the entitlement
model can be revised on a product decision rather than a migration.

**Exit:** met for metering and enforcement. Selling a plan waits on the
provider above.

---

## Phase 9 — Scale, reliability, multi-region *(2–3 weeks)*

- Define SLOs before optimising: p95 turn latency, watcher run success rate, voice session drop rate.
- Multi-region Cloud Run + Firestore multi-region (**location is fixed at creation — decide before Phase 0 applies prod**).
- Load test to the SLO; add `min-instances` only if cold starts measurably breach it, since it removes scale-to-zero.
- Chaos: kill a worker, drop the orchestrator, expire a token.

**Exit:** SLOs met under load; a region loss degrades rather than fails.

---

## Sequencing

```
Phase 0 ─▶ Phase 1 (A2A) ─┬─▶ Phase 2 (streaming) ─┐
                          └─▶ Phase 3 (research)  ─┴─▶ Phase 4 (ship)
                                                        │
                              ┌─────────────────────────┼──────────────┐
                              ▼                         ▼              ▼
                        Phase 5 (voice)        Phase 6 (connectors)   ...
                                                        │
                                                        ▼
                                              Phase 7 ─▶ 8 ─▶ 9
```

Phases 2 and 3 can run in parallel once A2A lands. Phase 5 and 6 are independent of each other. Phase 7 needs 6 (there is little to govern before connectors exist).

**Rough total: 10–14 weeks** of focused work, dominated by Voice and Connectors.

---

## Cross-cutting, every phase

- **Tests before the mechanism** for anything safety-bearing. The autonomy floor was written that way and it is the strongest code in the repo.
- **No key files, ever.** ADC locally, service accounts on Cloud Run, **no model credential in the browser**.
- **Traces are the product**, not debug output. Anything an agent decides must be explicable to the person it happened to.
- **Verify by running.** Every significant bug in this codebase so far — cold-load 401s, unwired mutations, evidence drift under redelivery, the invisible sheen — passed typecheck and was caught only by executing it.

## Open decisions

1. ~~**Firestore location**~~ — **settled 2026-08-25: `europe-west1`**, single region, matching Cloud Run. Created as `(default)` in the prod workspace and now unchangeable.
2. ~~**`@a2a-js/sdk` version line**~~ — **settled in Phase 1.** Both on 1.x: Python `a2a-sdk` 1.1.2, Node `@a2a-js/sdk` 1.0.1.
3. ~~**Does Firebase Hosting buffer SSE?**~~ — **settled in Phase 2, and the answer changed the design.** Buffering is the lesser problem; Hosting's unconfigurable 60s rewrite timeout is disqualifying on its own. The stream is served from the gateway's own hostname. See [decisions/0001](decisions/0001-sse-not-behind-firebase-hosting.md).
4. ~~**Plus tier price.**~~ — **settled 2026-08-26: £18/month.** It lives in `libs/metering` beside the allowances it buys, because a limit and its price must change in the same diff — splitting them is how a plan ends up costing more without offering more, with neither change looking wrong alone.
5. **Payment provider.** Deferred 2026-08-26 pending product validation of the plan shape. Metering and enforcement are complete and provider-agnostic; only the write to `subscriptions/{uid}.tier` is missing. Building webhooks and proration against limits that may still change is expensive to undo once real money has moved through it.
6. **EU data residency.** Vertex is pinned to `global`, which has none — services run in europe-west1 but model calls do not. If residency is ever required, the endpoint moves and the model pins to a DRZ-supported one.
7. ~~**Voice transport.**~~ — **settled 2026-08-26: gateway WebSocket relay, not LiveKit.** Vertex cannot mint ephemeral Live tokens; native audio is the language answer (no picker; Igbo unsupported). See [decisions/0006](decisions/0006-voice-through-the-gateway.md). Revisit only for PSTN or multi-party.
8. ~~**`/healthz` on `*.run.app`.**~~ — **settled 2026-08-26: both spellings are registered** on all six services. Google's frontend swallows the exact path `/healthz`, while `/healthz/` gets through — and FastAPI would answer the latter with a 307 redirect to the path that never arrives, so the trailing-slash route is declared explicitly rather than left to `redirect_slashes`. Whoever writes the next probe cannot pick the wrong one.
9. **Connector count.** The Production Roadmap's Phase 6 exit is *at least five* first-party connectors with least-privilege OAuth (Docs, Gmail, Calendar, Drive, GitHub, Notion named). The Implementation Plan scoped the submission to **one**, and recommended Google Docs. What exists is **Calendar** — one real connector plus its in-memory twin. Either the recommendation moves to Calendar or a Docs connector is added; today the two documents disagree.
