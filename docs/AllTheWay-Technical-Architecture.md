# AllTheWay — Technical Architecture Document
### Serverless-first architecture for a unified companion: Collaborative Partner + Voice + Autonomous Watchers + Enterprise Trust

*Updated for Product Manifest v2's unified-tracks scope. Preference memory is the Firestore Cognitive Profile, not Vertex AI Memory Bank — see [Memory Layer Plan](AllTheWay-Memory-Layer-Plan.md) (2026-08-28). §11 and §12 are Voice and Watcher Runtime architecture.*

---

## 1. Architecture Principles

1. **Serverless everywhere it's viable.** Every compute component runs on Cloud Run (request-driven) or Cloud Run Jobs (batch/long-running), scaling to zero between sessions. No GKE, no always-on VMs, no dedicated database clusters. This is both a cost discipline (matches the hackathon's own cost guidance) and a judged criterion ("Architectural Discipline").
2. **Managed state over hand-rolled state.** Short-term session state is Firestore, not an in-memory dict that dies with the container. Async coordination is Pub/Sub + Eventarc, not a homebrew job queue. **Preference memory is the Firestore Cognitive Profile** (`users/{uid}/preferences`), inspectable and revertible; working memory is the librarian's path-scoped vectors. Vertex AI Memory Bank is a deferred extractor behind that ledger, not the source of truth — see [Memory Layer Plan](AllTheWay-Memory-Layer-Plan.md) (2026-08-28). A black-box store would undo the product's own claim that memory is something you can read and put back.
3. **Two frameworks, two layers, one reason each.** ADK owns multi-agent orchestration (routing, sub-agent composition, tool use). Genkit owns the application-flow layer (typed request/response contracts between the frontend and the backend, structured-output prompts, streaming to the client). Neither is used to duplicate what the other already does well.
4. **The graph is the spine; the swarm is a leaf.** Anything user-visible or stateful runs through a deterministic ADK graph (Sequential/Parallel/Loop/LlmAgent router). A bounded swarm exists only inside the Research Cell, never touches the user directly, and always reconverges through a single synthesis node before the parent graph continues. This follows the 2026 consensus that supervisor/graph patterns trade some flexibility for the traceability and debuggability that swarms give up — a trade this product needs, since a companion that can't explain itself undermines its own value proposition.
5. **Every inter-agent boundary is a protocol boundary, not a function call.** Internal specialist agents (Research Cell workers, Profile Synthesizer, the Watcher Runtime) talk to the Orchestrator over A2A (JSON-RPC 2.0 + SSE, AgentCard-based discovery), not direct Python imports. This costs a small amount of latency now, in exchange for meaning that adding a new specialist agent later (e.g., a Legal Explainer) never requires touching the Orchestrator's code — it just needs to publish an AgentCard.
6. **Autonomy and voice both route through the same graph, not a shortcut around it.** A Watcher-triggered run and a voice-originated turn both instantiate the same Orchestrator graph, Clarify Gate, and Feedback Ledger a live text session would use. There is no separate "fast path" for autonomous or spoken actions that skips the Plan Panel/trace machinery — this is what keeps the product's core trust story (visibility, correctability) true even as it gains the ability to talk and to act unsupervised.
7. **Identity is a Phase 1 concern, not a Phase 5 concern.** Because Watchers take real-world actions without a user actively supervising each step, least-privilege Agent Identity between every internal service is built from the first deployment, not retrofitted once autonomous action already exists in production.

---

## 2. System Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│  CLIENT SURFACES                                                      │
│  Web (React/Vite SPA)  Mobile (shared cross-platform shell, voice)    │
│  Browser extension (MV3 side panel)   Desktop companion (Electron,    │
│  local file watcher + voice)                                          │
└───────────────────────────┬───────────────────────┬─────────────────────┘
                             │  HTTPS + Firebase      │  WebRTC/bidirectional
                             │  Auth ID token          │  stream (voice)
                             ▼                        ▼
                                              ┌──────────────────────┐
                                              │ Gemini Live API       │
                                              │ session (3.1 Flash    │
                                              │ Live) — audio-to-audio│
                                              └───────────┬────────────┘
                                                           │ tool calls route
                                                           │ into the same
                                                           ▼ Orchestrator below
┌───────────────────────────────────────────────────────────────────────┐
│  EVENT SOURCES (Watchers)                                              │
│  Inbox push/poll · Calendar webhooks · Cloud Storage file-drop ·       │
│  Generic webhook ingestion → Pub/Sub → Eventarc → Watcher Runtime       │
└───────────────────────────┬───────────────────────────────────────────┘
                             │  instantiates the same graph as a live session
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Cloud Run: API GATEWAY  (Genkit — Node/TS)                          │
│  • Auth verification (Firebase Admin SDK)                             │
│  • Genkit flows: createSession, sendMessage (streaming),             │
│    getPlan, getProfile, submitFeedback, registerConnector             │
│  • Structured-output prompts (Plan Panel JSON, Preference diff JSON)  │
│  • min-instances: 0, concurrency: 40, CPU always-allocated: false    │
└───────┬───────────────────────────────────────────┬────────────────────┘
        │ invokes (internal, IAM-authenticated)      │ writes/reads
        ▼                                            ▼
┌────────────────────────────────┐     ┌─────────────────────────────────┐
│ Cloud Run: ORCHESTRATOR AGENT   │     │  Firestore (Native mode)        │
│ (ADK — Python)                  │     │  sessions/{id}                  │
│ • LlmAgent router (Gemini 3.5   │     │  sessions/{id}/planNodes/{id}   │
│   Flash) — Clarify Gate,        │     │  sessions/{id}/feedbackEvents   │
│   Plan Panel graph orchestration│     │  users/{id}/connectors          │
│ • Sequential/Parallel/Loop       │     │  traceSpans/{id} (mirrored from │
│   sub-agents                    │     │   Cloud Trace for in-app view)  │
│ • Emits OpenTelemetry spans      │     └─────────────────────────────────┘
│ min-instances: 0 (1 for demo)   │
└───────┬─────────────┬───────────┘
        │ A2A (JSON-RPC│+SSE)      │ A2A
        ▼              ▼           ▼
┌───────────────┐ ┌──────────────┐ ┌───────────────────────┐
│ Cloud Run:     │ │ Cloud Run:   │ │ Cloud Run:              │
│ RESEARCH CELL  │ │ DELIVERABLE  │ │ PROFILE SYNTHESIZER    │
│ (ADK Parallel, │ │ GENERATOR    │ │ Deterministic keyed     │
│ 2–4 Flash      │ │ (Genkit flow,│ │ write (TEPA revoke).    │
│ workers +      │ │ Gemini 3.5   │ │ Pub/Sub push, writes    │
│ Synthesis node)│ │ Pro)         │ │ users/{uid}/preferences  │
│ MCP tool calls │ │              │ │                         │
└───────┬────────┘ └──────┬───────┘ └───────────┬─────────────┘
        │                 │                     │
        ▼                 ▼                     ▼
┌───────────────────────────────────────────────────────────────┐
│  MCP CONNECTOR LAYER (Cloud Run, one service per connector      │
│  or a pooled multi-tool server behind an API Gateway)           │
│  Google Docs · Gmail · Calendar · GitHub · Notion · third-party │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  Firestore Cognitive Profile + librarian                         │
│  users/{uid}/preferences (standing rows injected every turn)    │
│  users/{uid}/documentChunks (per-turn retrieval, not injection) │
│  users/{uid}/visualPreferences (applied at image generate)      │
│  users/{uid}/concepts (struggle model: reask and miss only)     │
│  Memory Bank is an optional extractor behind this ledger         │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  Pub/Sub topics: session.ended · profile.sync.requested ·       │
│  research.fanout.requested · notify.user                        │
│  Eventarc triggers route these to Cloud Run / Cloud Run Jobs     │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  Cross-cutting: Cloud Trace + Cloud Logging (OpenTelemetry)     │
│  Secret Manager (API keys, OAuth client secrets)                │
│  Firebase Auth (identity) · Firebase Cloud Messaging (push)      │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Component-by-Component Design

### 3.1 API Gateway (Genkit, Cloud Run)

- Genkit is deployed to Cloud Run via `startFlowServer()` rather than Cloud Functions for Firebase, because the gateway needs to proxy long-lived streaming connections to the Orchestrator and Cloud Functions' request model is a worse fit for that than a Cloud Run service with `CPU always allocated: false` and generous concurrency. (Cloud Functions via `onCallGenkit` remains the right choice for isolated, short-lived flows — e.g., `registerConnector` — and MVP scope can mix both if convenient.)
- Every flow is defined with typed Zod (TS) input/output schemas, so the frontend gets compile-time-checked contracts instead of hand-parsed JSON.
- Streaming: the `sendMessage` flow uses Genkit's chunked streaming (`sendChunk`) so the web/mobile/extension clients render agent tokens as they arrive rather than waiting for a full turn — this is what makes the Plan Panel and chat feel responsive rather than "submit and wait."
- Auth: every request carries a Firebase Auth ID token; the gateway verifies it server-side before invoking the Orchestrator, and passes only an opaque, verified `user_id` downstream — no client-supplied identity ever reaches the agent layer.

### 3.2 Orchestrator Agent (ADK, Cloud Run)

- Deployed with `adk deploy cloud_run --with_ui --a2a`, which — in a single command — gives the service an A2A endpoint (so the API Gateway and other agents can address it via AgentCard) alongside its normal API surface.
- Structure: a root `LlmAgent` (Gemini 3.5 Flash) acts as the router/coordinator. Its `description` field is written precisely, since ADK's dynamic routing uses that field as the effective "API documentation" the router reads to decide where to delegate.
- The Plan Panel itself is modeled as a graph of `SequentialAgent`/`ParallelAgent`/`LoopAgent`/`CustomAgent` nodes (ADK's newer unified Workflow graph model). State passes between nodes via `session.state[output_key]` — ADK's "shared whiteboard" pattern — rather than nodes calling each other directly, which keeps every node swappable and independently testable.
- The **Clarify Gate** is implemented as a mandatory `CustomAgent` checkpoint that the router cannot bypass: before any node that would consume non-trivial tool budget, a cheap Gemini Flash call scores instruction ambiguity, and above threshold the flow branches to a clarification sub-agent instead of proceeding.
- **Session persistence**: `DatabaseSessionService` (ADK) backed by Firestore, not `InMemorySessionService` — this is what makes "pause a session for three days, resume later" (FR-6 in the product manifest) actually work, since Cloud Run containers are ephemeral and cannot be relied on to hold state in process memory between requests.
- min-instances is 0 for cost during development, bumped to 1 only immediately before the live demo to eliminate cold-start latency on camera.

### 3.3 Research Cell (ADK ParallelAgent, Cloud Run)

- 2–4 worker sub-agents, each running Gemini 3.5 Flash with a distinct tool/strategy (web search via an MCP search connector, connected-document RAG via passages the gateway already retrieved, prior-session thread the gateway already loaded). Standing preferences are injected by the gateway; workers do not call Memory Bank.
- ADK's `ParallelAgent` isolates each branch's intermediate events from the others (branch isolation), so workers cannot see or influence each other mid-flight — this is what keeps the "bounded swarm" bounded: no emergent cross-talk, no runaway coordination cost.
- A single Synthesis node reconverges the branches. Only the Synthesis node's output re-enters the parent graph; per FR-10, workers never emit directly to the user.
- Hard caps: `max_workers=4`, workers restricted to Flash (never Pro), and a wall-clock timeout per fan-out — this is the direct mitigation for the "swarm-style Research Cell runs away on cost" risk called out in the product manifest.

### 3.4 Deliverable Generator (Genkit flow, Cloud Run or Cloud Functions)

- A Genkit flow, not an ADK agent — this is a single-shot structured-generation task (produce a wireframe spec, a summary, a draft), which is exactly Genkit's sweet spot (typed structured output, no multi-step reasoning graph required). Runs on Gemini 3.5 Pro, since this is the "final reasoning / deliverable" tier the hackathon cost guidance explicitly recommends reserving Pro for.
- Genkit's built-in plugin ecosystem is what supplies the model connection here (`@genkit-ai/google-genai` for Vertex AI/Gemini access) — no bespoke SDK wiring needed.

### 3.5 Profile Synthesizer (Cloud Run service, event-driven)

- Deployed as a **Cloud Run service** that consumes Pub/Sub push on `/events`, same shape locally and in production. A Job is the wrong shape once a correction must be learned before the next turn in the same session.
- Trigger path: a human correction (or session end) → gateway publishes `session-ended` → this service writes `users/{uid}/preferences`. Watchers subscribe to the same topic for `session_ended` triggers; they do not write the profile.
- Internally: deterministic. A correction already contains both halves (`was` / `now`). The write is keyed (TEPA): a new fact under the same key stamps `revertedAt` on the previous active row rather than leaving two opposites in the prompt. Evidence counts same-key rows, not every preference the user has.
- Reads at turn time: the **gateway** lists standing preferences (`revertedAt == null`) and injects them. The orchestrator is stateless and never fetches the profile itself. Working memory is retrieved separately, as passages, never injected as if it were a preference.

### 3.6 MCP Connector Layer (Cloud Run, one or pooled)

- Each connector (Docs, Gmail, Calendar, GitHub, Notion) is an MCP server exposed over HTTP transport, deployable independently on Cloud Run — MCP servers are plain request/response services and scale-to-zero like everything else here.
- For anything beyond MVP scope, connectors sit behind an API Gateway layer that handles auth, rate-limiting, and audit logging centrally rather than duplicating that logic in every connector — the production pattern documented across current MCP/A2A architecture guides (agent → gateway → MCP server pool).
- Third-party/community MCP servers can be registered without a redeploy of the core system, since the Orchestrator discovers tool capability through each server's self-description rather than hardcoded bindings.

### 3.7 Guardrails

- A lightweight guardrail step (modeled on the Model Armor pattern from the Fortified Enterprise Fleet track, even though this submission targets Collaborative Partner) sits between any fetched external content (web pages, documents) and the point where that content enters the Orchestrator's context — screening for prompt injection before it can influence agent behavior.
- PII redaction runs before any write to the Cognitive Profile, since memories are long-lived and scoped per identity; anything written there persists across every future session. Watcher-ingested text is never a profile source.

---

## 3.8 Voice Architecture (Gemini Live API)

- **Model**: Gemini Live native audio (`gemini-live-2.5-flash-native-audio`) via the Live API — audio-to-audio, not a speech-to-text-to-LLM-to-text-to-speech chain, which is what preserves conversational latency and vocal nuance (tone, pacing, interruption handling). Native audio auto-detects and switches language; `language_code` cannot be set. Igbo is not in the current language list.
- **Integration point**: the Live API session connects into the same Orchestrator's tool-calling surface used by text sessions — a spoken instruction resolves to the same ADK tool calls a typed instruction would, via function calling (Flash Live's benchmarked strength on mapping spoken requests to correct function calls).
- **Transport**: a WebSocket relay in the API Gateway. The browser talks only to us; the gateway holds the Vertex Gemini Live session under its own ADC identity. The browser holds no model credential. LiveKit is not used — AllTheWay is 1:1, and LiveKit's value is an SFU for multi-party rooms. See [decisions/0006](decisions/0006-voice-through-the-gateway.md). Architecture previously named LiveKit as an example; that is superseded.
- **The confirm-summary gate**: before any tool call with a real-world side effect executes, the Orchestrator generates a spoken summary of the pending action(s) and requires an explicit confirmation turn — implemented as a mandatory step in the tool-calling flow, not a prompt-level suggestion the model could skip. This mirrors the text-mode Clarify Gate's architecture (a hard checkpoint, not a soft instruction) applied to the "about to act" moment instead of the "about to plan" moment.
- **Known constraint**: current Live models do not reliably support switching between differently-instructed sub-agents mid-session (a documented limitation as of the 3.1 generation). Consequently, voice sessions run against a single Orchestrator context with a broad tool surface, rather than attempting live delegation to the Research Cell or other specialist sub-agents mid-call. If a voice turn would benefit from Research Cell-style parallel work, the Orchestrator queues it as a Plan Panel step for the user to see and approve after the voice turn ends, rather than trying to delegate invisibly mid-conversation. Re-validate this constraint against each new Live API model generation — it is a current technical limit, not a permanent design choice.
- **Graceful degradation**: low-confidence transcription (background noise, ambiguous phrasing) routes to a clarifying spoken follow-up rather than acting on a guess — the same "confirm before executing, don't guess" posture the confirm-summary gate embodies generally.
- **State sharing**: voice sessions use the same Firestore session documents and the same Firestore preference ledger as text sessions — there is no separate "voice memory." A session begun by voice and continued as text (or vice versa) is one continuous session, not two. Live chit-chat stays a Live-model session; the moment it calls `plan_turn`, the gateway loads the same four stores a typed turn does.

## 3.9 Watcher Runtime Architecture

- **Trigger ingestion**: each supported trigger type (inbox push/poll, calendar webhook, Cloud Storage file-drop, generic webhook) publishes to a dedicated Pub/Sub topic; an Eventarc trigger invokes the Watcher Runtime — the same asynchronous-invocation pattern already used for the Profile Synthesizer's `session.ended` trigger, extended to external event sources rather than reinvented.
- **Execution model**: a Watcher Runtime invocation instantiates the *same* ADK Orchestrator graph a live chat session would use — Plan Panel construction, Clarify Gate, Feedback Ledger writes, all identical. A Watcher is not a simplified or separate execution engine; it's the standard graph triggered by an event instead of a chat message.
- **Unattended Clarify Gate behavior**: when the Clarify Gate would normally interrupt a live chat turn to ask the user a question, and no user is actively in-session, the Watcher Runtime instead pauses that specific run and publishes a `notify.user` event (routed to push notification via Firebase Cloud Messaging) requesting the clarification — the run resumes from its checkpoint once the user responds, using the same Firestore-backed session-resumability mechanism §3.2 already provides for paused live sessions.
- **Autonomy ceiling enforcement**: each Watcher carries a per-action-category permission map (`draft_only` / `review_required` / `auto_execute`), stored alongside the Watcher's definition in Firestore and checked by the Orchestrator's tool-execution layer before any tool with a real-world side effect runs — not just checked at Watcher-creation time. Irreversible/high-stakes categories (external communication sends, financial actions, deletions) are hard-coded to a `review_required` floor in the tool-execution layer itself, not merely as a default in the UI, so a compromised or misconfigured Watcher definition cannot bypass it client-side.
- **Guardrail placement**: since Watchers are the system's primary consumer of *untrusted* external content (an inbound email or a scraped web page was not written by the user and may be adversarial), the Model Armor-equivalent guardrail screening from §3.7 sits directly in the Watcher Runtime's content-ingestion path, before any external content enters the Orchestrator's context — not applied only at the connector layer, since a Watcher may process content that never passed through a connector call in the traditional sense (e.g., a raw inbound webhook payload).
- **Deployment**: the Watcher Runtime is a Cloud Run service (not a Job) when it needs to hold a notification-wait state efficiently, or a Cloud Run Job for one-shot trigger-to-completion runs with no mid-run pause — the choice is per-Watcher-type based on whether unattended clarification pausing is a realistic scenario for that trigger type.

---

## 4. Data Model (Firestore — Native mode, serverless, no provisioning)

```
sessions/{sessionId}
  ownerId: string
  goal: string
  status: "active" | "paused" | "completed"
  createdAt, updatedAt: timestamp
  planGraphRef: string

sessions/{sessionId}/planNodes/{nodeId}
  type: "sequential" | "parallel" | "loop" | "custom"
  status: "pending" | "active" | "done"
  outputKey: string
  checkpointState: map        # resumability — survives container recycling

sessions/{sessionId}/feedbackEvents/{eventId}
  nodeId: string
  type: "accept" | "edit" | "reject" | "reask" | "skip"
  before: string | null
  after: string | null
  signalClass: "explicit" | "implicit"
  timestamp: timestamp

users/{userId}/connectors/{connectorId}
  mcpEndpoint: string
  scopes: array<string>
  addedAt: timestamp

users/{userId}/watchers/{watcherId}
  triggerType: "inbox" | "calendar" | "fileDrop" | "webhook"
  triggerConfig: map
  goal: string
  autonomyMap: map<actionCategory, "draft_only" | "review_required" | "auto_execute">
  status: "active" | "paused"
  createdAt, lastRunAt: timestamp

users/{userId}/watchers/{watcherId}/runs/{runId}
  sessionRef: string          # links to the sessions/ collection — a Watcher
                                run IS a session, sharing the same schema
  triggeredBy: map             # the event payload that started this run
  status: "queued" | "awaiting_clarification" | "completed" | "failed"

traceSpans/{spanId}                # mirrored subset of Cloud Trace, for the
  sessionId, nodeId, kind, ts, dur   in-app Transparent Trace UI — the source
                                      of truth remains Cloud Trace/OpenTelemetry
```

Cognitive Profile **is** stored in Firestore as primary data: `users/{userId}/preferences/{preferenceId}`, with `revertedAt` as the validity stamp (TEPA) and optional `hat` so work and home do not mix. Proposed `source: "synth"` rows are visible on You and not injected until accepted. Struggle rows live at `users/{userId}/concepts/{id}` and are written only on reask or a missed check. There is no `profileSnapshot` and no Memory Bank round-trip on the turn path, because the You screen and the orchestrator must read the same rows. Vertex AI Memory Bank is an optional extractor behind this ledger (`MEMORY_BANK_RESOURCE`, topics: `USER_PREFERENCES` only), not a second source of truth. Working memory is not this collection — it is `users/{userId}/documentChunks`, retrieved per turn, with the same hat rule as preferences (unlabelled always retrieves).

Why Firestore over Cloud SQL for everything else: session/plan/feedback data is naturally document-shaped (nested, per-session, no cross-session joins needed for MVP), and Firestore's serverless pricing (pay-per-operation, no idle cost) matches the "scale to zero" principle in a way a provisioned Cloud SQL instance cannot. Cloud SQL is deferred to the post-hackathon roadmap, and only if the Connector Marketplace grows to need genuine relational integrity (e.g., many-to-many org-level connector sharing with foreign-key constraints).

---

## 5. Multi-Agent Orchestration — Concrete Pattern Choice

Per the current (2026) production guidance on multi-agent topologies — which distinguishes **pipeline**, **fan-out/parallel**, **debate**, **supervisor/hierarchical**, and **swarm** as operationally distinct patterns, each with a different cost/traceability/latency profile — AllTheWay uses:

| Layer | Pattern | Why |
|---|---|---|
| Orchestrator → Plan Panel | Supervisor (LlmAgent dynamic routing) over a Sequential/Parallel/Loop graph | Predictable, debuggable, matches "Architectural Discipline" judging criterion |
| Research Cell | Bounded fan-out/parallel (not open swarm) | Coverage/speed benefit of parallelism without swarm's traceability cost — the swarm is a leaf, never the spine |
| Profile Synthesizer | Deterministic keyed write, with revoke-on-conflict (TEPA), then a sleep-time pass that generalises *across* keys | A single correction already contains both halves; a model restating it adds drift. Sleep-time writes a new `source: "synth"` row and never overwrites a human one |
| Cross-service (Orchestrator ↔ Research Cell ↔ Profile Synthesizer ↔ Connectors) | A2A (peer protocol) | Each of these is an independently deployable Cloud Run service; A2A means adding a new specialist later requires zero changes to the Orchestrator's code, only a new AgentCard |

This directly avoids the two documented anti-patterns: an unbounded swarm ("obscures the execution path, making it difficult to trace errors"), and a single monolithic supervisor doing everything ("can become a bottleneck if poorly defined") — the Orchestrator delegates real work to independently scalable Cloud Run services rather than doing it all in one process.

---

## 6. A2A & MCP Contract Details

- **A2A v1.0** (Linux Foundation-governed): canonical data model is `AgentCard`, `AgentSkill`, `Task`, `Message`, `Part`, `Artifact`; operations are `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`; primary binding is JSON-RPC 2.0 over HTTPS with SSE for streaming. Every internal AllTheWay service (Orchestrator, Research Cell, Profile Synthesizer) publishes a signed AgentCard at `/.well-known/agent-card` describing its skills, so discovery is self-service rather than hardcoded.
- **MCP** governs the vertical agent-to-tool edge (Orchestrator/Research Cell → connectors); **A2A** governs the horizontal agent-to-agent edge. This is the same complementary split the current agent-protocol ecosystem has converged on industry-wide, not an AllTheWay-specific invention — which matters for judging, since it signals the architecture follows an emerging standard rather than a bespoke one-off integration.

---

## 7. Security & Identity

- **Built from Phase 1, not added later.** Because Watchers take real-world actions without a user actively supervising each step, this section is treated as foundational architecture, not a later hardening pass — every point below is true from the system's first production deployment.
- **Firebase Auth** issues identity for all four surfaces (web, mobile, extension, desktop). Voice is authenticated as the same user: the browser's first message on the gateway WebSocket carries a Firebase ID token; the gateway then holds the Vertex Live session itself. Cloud Run services never accept unauthenticated invocation from the public internet except the API Gateway itself; every internal service-to-service call (Gateway → Orchestrator → Research Cell/Profile Synthesizer/Watcher Runtime/Connectors) is IAM-authenticated using dedicated, least-privilege service accounts per service — mirroring the documented best practice of scoping each Cloud Run service and Eventarc trigger to the minimum permissions it actually needs.
- **Secret Manager** holds all third-party OAuth client secrets and API keys; nothing sensitive lives in environment variables or source.
- **Eventarc triggers** are similarly scoped: the trigger's service account can invoke exactly one target service, nothing broader — this now includes every Watcher trigger source (inbox, calendar, file-drop, webhook), each scoped individually rather than sharing one broad trigger identity.
- **Watcher action authorization** is enforced at the tool-execution layer (§3.9), not only at the UI level — a Watcher's autonomy-ceiling map is checked server-side on every tool call with a real-world side effect, and the `review_required` floor on irreversible actions is not bypassable by a client-side setting change alone.
- Browser extension and desktop companion never receive a long-lived credential — short-lived Firebase ID tokens only, refreshed per session.

---

## 8. Observability

- Every ADK agent and Genkit flow emits OpenTelemetry spans (`adk deploy ... --trace_to_cloud` wires this automatically for ADK services) to Cloud Trace.
- A subset of spans relevant to a given session is mirrored into Firestore (`traceSpans/`) specifically to power the in-app **Transparent Trace** UI — Cloud Trace remains the operational source of truth (for engineering debugging), while the Firestore mirror is a lightweight, user-facing read model (so the product doesn't need to proxy Cloud Trace's full API surface into a consumer-facing UI).
- Cloud Logging captures structured logs from every service; log-based metrics drive budget alerts (per the hackathon's own cost guidance).

---

## 9. Scaling & Cost Posture

| Setting | Value | Rationale |
|---|---|---|
| Cloud Run min-instances | 0 (all services, except briefly during live demo) | No idle cost; "pop-up shop" model — 0 requests, 0 running instances |
| Cloud Run max-instances | Capped per service (e.g., 5–10) | Blocks unexpected spend spikes without hand-tuning autoscaling |
| Gemini model tier default | Flash | Reserved for routing, classification, Research Cell workers, Clarify Gate scoring |
| Gemini model tier escalation | Pro | Only for Deliverable Generator. The Profile Synthesizer is deterministic in this phase. |
| Vector search | Librarian path-scoped vectors on `users/{uid}/documentChunks` | No dedicated always-on vector database cluster; Memory Bank is not the working-memory index |
| Cloud Run Jobs task timeout | Default 10 min, extendable to 7 days if ever needed | Profile Synthesizer in practice completes in seconds–minutes; headroom exists without needing a different compute model |

---

## 10. Deviations From "Pure Serverless" (and why they're justified)

- **Desktop companion** is the one surface that is inherently not serverless (it's a local process on the user's machine). This is scoped to sync structured events only, never raw files, keeping the cloud-side footprint serverless even though the client itself is not.
- **GKE is explicitly excluded** from MVP and near-term roadmap. It would only become relevant if AllTheWay needed to run open-weight models locally (e.g., a fine-tuned classifier) at a scale where Cloud Run's per-request model stopped being cost-effective — not a near-term need.

---

*This document should be read alongside Product Manifest v2 (feature/requirements source of truth) and the AllTheWay Production Implementation Roadmap (execution sequencing across all ten phases). The original 10-day sprint plan remains the execution detail for Milestone 1.1 specifically, and targets the Collaborative Partner-only slice of this architecture — §3.8 (Voice) and §3.9 (Watchers) are Phase 3/4 roadmap work, not part of that sprint.*

---

## Appendix — implementation deltas (2026-08-24)

Recorded here rather than silently editing the body, so the reasoning stays
visible alongside the original design.

- **Web is a React/Vite SPA, not Next.js.** Chosen for the faster dev loop and
  a server-less hosting model. The SEO and first-paint gap that Next's SSG
  would have covered is accepted: the marketing page's OG/meta tags are static
  in `index.html`, so link unfurls work, and Googlebot executes JS. There is no
  prerender step and no browser in the build.
- **Marketing and product share one origin.** Marketing at `/`, the product at
  `/app`. Firebase Hosting rewrites `/api/**` to the gateway, so the client is
  same-origin and there is no CORS anywhere. The service worker is registered
  only inside `/app` — a first-time visitor reading the landing page is never
  charged for an app install.
- **Repo layout.** Backend services live under `/services`; `contracts` sits
  there too because the services define the wire format and `web` consumes it.
- **No Cloud Deploy.** One GCP project, two environments (`dev`, `prod`)
  separated by Terraform workspace, `develop` → dev and `main` → prod. Cloud
  Deploy's promotion model would add per-pipeline cost for machinery this shape
  does not use.
- **Vertex endpoint is `global`**, pinned to `gemini-3.7-flash`. Independent of
  the Cloud Run region (`europe-west1`). `global` carries no EU data residency;
  if that becomes a requirement the endpoint moves and the model pins back to a
  DRZ-supported one.
- **Email verification is a six-digit code, not a link.** Firebase Auth has no
  native email-code flow, so codes are issued and checked by the gateway:
  SHA-256 hashed, 10-minute TTL, single use, five attempts then burned,
  30-second resend cooldown, constant-time comparison.
- **One `firebase.json` at the repo root** covering emulators, Firestore rules
  and Hosting. The CLI resolves config by working directory, so a second file
  under `web/` made the answer depend on where you stood.
