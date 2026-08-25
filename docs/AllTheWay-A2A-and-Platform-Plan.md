# AllTheWay — A2A & Platform Implementation Plan

**Status:** Phases 1–6 delivered (2026-08-25; voice and Model Armor partial); Phases 0, 7–9 proposed · **Date:** 2026-08-25 · **Assumes:** a GCP project exists, billing enabled, `gcloud auth application-default login` done.

Covers the gap between what is built today and the Production Roadmap's phases 5–10, with **A2A at every internal boundary** as the load-bearing first phase.

---

## 0. Where we are

| Built | Not built |
|---|---|
| `web` (marketing + `/app`, auth, 5 screens) | Research Cell |
| `gateway` (Express, Firebase ID tokens, Firestore repos, Pub/Sub publisher) | Voice (Pillar 2 entire) |
| `orchestrator` (Clarify Gate → Plan, FakeProvider) | Streaming |
| `watcher-runtime` (autonomy floor, 22 tests) | Connectors / MCP / Model Armor |
| `profile-synthesizer` (idempotent, ledger-safe) | Agent Registry, monetization, multi-region |
| `infra` (Terraform, validated, never applied) | Dockerfiles → **CI cannot build anything** |

**The critical deviation:** internal calls are plain HTTP+JSON. The architecture doc mandates A2A (JSON-RPC 2.0 + SSE, AgentCard discovery) at every inter-agent boundary. Phase 1 fixes this, and everything after depends on it.

---

## Research basis

Findings that shaped the plan, verified against current sources:

- **A2A is at v0.3.x** (spec [a2a-protocol.org](https://a2a-protocol.org/latest/specification/)). Methods: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, `GetExtendedAgentCard`, plus four push-notification-config methods. Clients must send an **`A2A-Version` header** for version negotiation.
- **Agent cards** live at `/.well-known/agent-card.json`, may be signed, and carry capabilities, skills, security schemes and supported interfaces.
- **Task states**: `TASK_STATE_SUBMITTED`, `WORKING`, `COMPLETED`, `FAILED`, `CANCELED`, `INPUT_REQUIRED`, `REJECTED`, `AUTH_REQUIRED`.
- **Streaming** is SSE, carrying `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` inside a `StreamResponse`.
- **Security schemes**: `APIKeySecurityScheme`, `HTTPAuthSecurityScheme`, `OAuth2SecurityScheme`, `OpenIdConnectSecurityScheme`, `MutualTlsSecurityScheme`.
- **ADK exposes agents** with `to_a2a(root_agent, port=…)` from `google.adk.a2a.utils.agent_to_a2a`, which auto-generates the card and wires an `A2aAgentExecutor`, `InMemoryTaskStore` and a Starlette app. It consumes with `RemoteA2aAgent` + `AGENT_CARD_WELL_KNOWN_PATH` from `google.adk.agents.remote_a2a_agent`.
- **A JS SDK exists** — `@a2a-js/sdk`, official. **Resolved during Phase 1:** both SDKs are on the 1.x line — Python `a2a-sdk` 1.1.2, Node `@a2a-js/sdk` 1.0.1. No version skew. (The 0.3.x figure in earlier research was stale.)
- **Gemini Live API** is stateful over WebSocket, audio-to-audio, supports function calling, and **requires ephemeral tokens in production** rather than API keys.
- **Model Armor** is a REST service screening prompts/responses for prompt injection, jailbreak, PII (150+ types via Sensitive Data Protection) and malicious URLs. Model-agnostic; needs Cloud Logging enabled to see sanitisation results.

### The insight that shapes everything

**The Clarify Gate is `TASK_STATE_INPUT_REQUIRED`.** Our central product rule — never act on an ambiguous request, stop and ask — is already a first-class state in the A2A task lifecycle. Adopting A2A doesn't just satisfy the architecture doc; it makes the Clarify Gate expressible in the protocol instead of encoded in a bespoke `decision` field. Watchers pausing for review (FR-W3) is the same state, and `TASK_STATE_AUTH_REQUIRED` maps cleanly onto a connector needing consent.

---

## Phase 0 — Make it real *(0.5 day)*

**Goal:** the existing stack runs against the real project.

1. Point `.env` at the real project; drop `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`; ensure `ALLOW_ANONYMOUS` is unset.
2. Apply `infra/bootstrap`, then `infra` for the `dev` workspace.
3. Set `USE_VERTEX=true` on the orchestrator and make the **first real Gemini call**. Verify `/healthz` reports `VertexProvider`, not `FakeProvider`.
4. **Firestore indexes** — correcting my earlier overstatement: single-field `orderBy` is auto-indexed, so today's queries need nothing. The real work is:
   - add `firestore.indexes.json` and reference it from `firebase.json`, so indexes are code before the first query that needs one;
   - declare the composite we *will* need: `runs` on `(watcherId ASC, at DESC)`;
   - add a **single-field exemption** for `sessions.plan` (an array of objects that would otherwise be indexed per element for no benefit);
   - add a **TTL policy** on `authCodes.createdAt` so expired verification codes are garbage-collected rather than accumulating.

**Exit:** a real Gemini-produced plan renders in `/app`, from real Firestore, with a real ID token.

---

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

### 1.4 Authentication between agents

Use `HTTPAuthSecurityScheme` (bearer) carrying **Google-signed OIDC ID tokens** — the same identity model Terraform already provisions (`run.invoker` granted per caller SA). Each agent validates the token's audience and issuer, so the A2A layer and the IAM layer agree rather than duplicating.

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

## Phase 4 — Ship it — **DELIVERED (images), BLOCKED (deploy)**

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

Full reasoning in [decisions/0003](decisions/0003-service-images.md).

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

### Not done — needs the GCP project

Connecting GitHub to Cloud Build is a one-time manual step, and the deploy and
smoke stages cannot run without a project. The exit criterion ("a commit to
`develop` builds, tests, deploys, passes smoke") is therefore met for build and
test, and unmet for deploy and smoke. This is the same boundary Phase 0 sits
behind.

---

## Phase 5 — Voice — **DELIVERED (gates), BLOCKED (Live API)**

**Goal:** talk to it; it confirms before acting. The two rules that make speech
different from typing are done, tested and verified in a browser. The audio
transport itself needs a GCP project.

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

### Not done — needs the GCP project

- **The Live API WebSocket session** (item 2). The ephemeral-token endpoint,
  its TTL and its refusal path are built and exercised; `VertexTokenMinter`
  deliberately throws rather than approximating a minting call that has never
  run. Writing it now would produce code that compiles, has never executed, and
  would be trusted because it looks finished.
- **Item 3** (single Orchestrator context) is satisfied by construction: the
  orchestrator already delegates research as a Plan Panel step rather than
  mid-turn, which is exactly what the constraint requires.

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

## Phase 7 — Agent Registry & governance *(1–2 weeks)*

**Goal:** discovery and audit, at scale.

**The registry is a catalogue of AgentCards** — which is why Phase 1 pays off twice. Each agent already publishes a signed, versioned card; the registry indexes them.

- Registry service: list/describe agents, versions, owners, skills.
- Card **signing** (the spec supports it) so a card cannot be spoofed.
- Transparent Trace as the consumer-facing view of the same audit log a security team consumes.
- Per-org policy: the FR-W4 ceiling waiver, with the auditable justification `watcher-runtime/app/policy.py` already models.

**Exit:** a new agent is discoverable by card alone; every action is attributable to an agent version and an identity.

---

## Phase 8 — Monetization *(1–2 weeks)*

- Meter the two dimensions with real marginal cost: **voice minutes** and **watcher runs**.
- Enforce at the Agent Gateway (limits are a policy concern, not a billing afterthought).
- Free / Plus / Team per the manifest §7. **The `$18` Plus price in the UI is a placeholder** and must be replaced with a real decision.
- Usage visible to the user *before* they hit a limit.

**Exit:** a Free account is stopped at its ceiling with a clear upgrade path; usage reconciles with billing.

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
- **No key files, ever.** ADC locally, service accounts on Cloud Run, ephemeral tokens in the browser.
- **Traces are the product**, not debug output. Anything an agent decides must be explicable to the person it happened to.
- **Verify by running.** Every significant bug in this codebase so far — cold-load 401s, unwired mutations, evidence drift under redelivery, the invisible sheen — passed typecheck and was caught only by executing it.

## Open decisions

1. **Firestore location** — fixed forever at creation, and Phase 0 applies prod. Decide now.
2. ~~**`@a2a-js/sdk` version line**~~ — **settled in Phase 1.** Both on 1.x: Python `a2a-sdk` 1.1.2, Node `@a2a-js/sdk` 1.0.1.
3. ~~**Does Firebase Hosting buffer SSE?**~~ — **settled in Phase 2, and the answer changed the design.** Buffering is the lesser problem; Hosting's unconfigurable 60s rewrite timeout is disqualifying on its own. The stream is served from the gateway's own hostname. See [decisions/0001](decisions/0001-sse-not-behind-firebase-hosting.md).
4. **Plus tier price.** Currently a placeholder in shipped UI.
5. **EU data residency.** Vertex `global` has none. If required, the endpoint moves and the model pins to a DRZ-supported one.
