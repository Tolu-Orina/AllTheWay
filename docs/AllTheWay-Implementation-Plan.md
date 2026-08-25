# AllTheWay — Phased Implementation Plan
### 10 days to submission (today: Aug 21, 2026 → deadline: Aug 31, 2026, 5:00pm PDT)

---

## 0a. Scope note (post Product Manifest v2)

The product's full scope has since expanded to four pillars — Collaborative Partner, Voice, Autonomous Watchers, and Enterprise Trust — sequenced across ten phases in the **Production Implementation Roadmap**. This document intentionally still covers only the Collaborative Partner slice: it is the execution detail for **Milestone 1.1** inside that roadmap's Phase 1, not a plan for the full product. Ten days was never going to fit voice, autonomous Watchers, and full enterprise governance, and this plan doesn't attempt to stretch to cover them — see the Production Roadmap for Phases 3 (Voice), 4 (Watchers), and 7 (Enterprise Trust, full) instead. One change does carry back into this sprint from the roadmap update: **Day 1's Agent Identity setup should be built to the roadmap's Phase 1 standard (dedicated least-privilege service account per service, from the first deployment)** rather than a looser hackathon-grade auth posture, since that foundation is now load-bearing for everything that follows it, not just nice-to-have hygiene.

---

## 0. Reading this plan

Ten days is not enough to build everything in the product manifest. This plan is deliberately ruthless about sequencing: it builds the smallest version of the product that (a) genuinely demonstrates the Collaborative Partner brief, (b) satisfies all three mandatory-tech requirements from day one rather than bolting them on late, and (c) leaves real days at the end for the demo video, architecture diagram, and README — because "Demo & Production Readiness" is 30% of the score and is exactly the kind of thing that gets rushed and penalized when engineering runs long.

**Non-negotiable MVP scope** (what must work, live, on camera):
1. A user can start a session with a goal.
2. The agent asks at least one real clarifying question via tappable chips (not free text) before producing a deliverable — this is the single most important behavior in the whole brief, and it must never be faked or skipped in the demo path.
3. The agent produces a visible, editable Plan Panel.
4. The user edits agent output at least once, and that edit visibly becomes a Feedback Ledger entry.
5. A second session (or a scripted "later" moment) shows the Cognitive Profile having changed as a result, and the agent visibly using it.
6. All of the above runs on Gemini 3.5 via Vertex AI, uses ADK **and** Genkit, and is provably deployed on Cloud Run + Firestore + Pub/Sub — captured live in the demo video per the submission requirements.

**Explicitly deferred past submission** (do not attempt in 10 days): browser extension, desktop companion, mobile native apps (a responsive web build stands in and is shown as "how this extends to mobile" in the video, not shipped as a store app), MCP connector marketplace beyond one connector, Teams/org tier, Research Cell beyond a single hard-coded 2-worker demo case.

---

## Phase 0 — Foundations (Day 1, Aug 21)

**Goal: every later day builds on working infrastructure, not on infrastructure being figured out.**

- Create GCP project, link billing, claim the $150 hackathon credit via the credit form, set a billing budget alert immediately (per the hackathon's own cost guidance).
- Enable required APIs: Vertex AI, Cloud Run, Firestore, Pub/Sub, Eventarc, Secret Manager, Cloud Trace, Cloud Build, Agent Engine (Memory Bank).
- Firebase project linked to the same GCP project; enable Firebase Auth (email + Google sign-in is sufficient for MVP) and Firebase Hosting for the web client.
- Repo scaffolding: npm-workspaces monorepo with `/web` (React/Vite SPA — marketing at `/`, the product at `/app`), `/services` (`contracts` shared zod wire types, `gateway` Genkit/TS, `orchestrator` ADK/Python, `research-cell` ADK/Python, `profile-synthesizer` ADK/Python, `watcher-runtime` ADK/Python), `/infra` (Terraform), `/scripts`, `/docs`.
- Firestore database created (Native mode), initial security rules (deny-all by default, opened per-collection as each feature lands).
- Confirm `adk deploy cloud_run` and `firebase deploy` both work end-to-end on a trivial "hello world" agent/flow **today** — this is the single highest-value risk-reduction task on Day 1. If deployment tooling is going to fight you, you want to know on Day 1, not Day 7.
- Write the README skeleton now (spin-up instructions section first) and keep it updated daily rather than reconstructing it on Day 10 from memory.

**Deliverable checkpoint:** a deployed, empty Cloud Run service reachable at a public URL, and a Genkit flow deployed and callable. Nothing product-shaped yet — that's expected.

---

## Phase 1 — Core Orchestration Loop (Days 2–4, Aug 22–24)

**Goal: the Clarify Gate → Plan Panel → deliverable loop works end-to-end for one hard-coded scenario, with real Gemini calls, no UI polish yet.**

### Day 2 — Orchestrator skeleton
- Build the root `LlmAgent` router in ADK, Gemini 3.5 Flash, with a `DatabaseSessionService` backed by Firestore (not in-memory) from the start — retrofitting persistence later is more expensive than building it in now.
- Implement the Plan Panel as an ADK graph: start with a single `SequentialAgent` chain of 3–4 fixed steps for one scenario (recommend: the "UI/UX helper that turns a vague idea into a wireframe" example from the track brief itself, since it's explicitly pre-validated by Google as a strong Collaborative Partner example).
- Deploy to Cloud Run with `adk deploy cloud_run --with_ui --a2a --trace_to_cloud`.

### Day 3 — Clarify Gate + Feedback Ledger
- Implement the Clarify Gate as a mandatory `CustomAgent` checkpoint (ambiguity scoring via a cheap Flash call) before the first real Plan Panel node executes.
- Implement Feedback Ledger writes: every accept/edit/reject/reask/skip event lands in `sessions/{id}/feedbackEvents` with before/after content captured for edits.
- Firestore schema for `sessions` and `planNodes` fully wired (see architecture doc §4).

### Day 4 — Gateway + streaming
- Stand up the Genkit API Gateway on Cloud Run: `createSession`, `sendMessage` (streaming via chunked output), `getPlan`, `submitFeedback` flows, each with a typed schema.
- Wire Firebase Auth token verification into the gateway.
- End-to-end smoke test: a scripted client can create a session, get a clarifying question, respond, see a Plan Panel update, and see a deliverable draft — all through real deployed Cloud Run services, no mocks.

**Deliverable checkpoint:** the entire Clarify → Plan → Deliverable loop works against deployed infrastructure, callable from a terminal script, for one fixed scenario. This is the moment to pause and verify — everything after this phase is building UI and polish on top of a loop that must already be correct.

---

## Phase 2 — Memory & Personalization (Days 5–6, Aug 25–26)

**Goal: the thing that actually differentiates this submission — the Cognitive Profile — is real, not a mockup.**

### Day 5 — Memory Bank wiring
- Stand up Vertex AI Agent Engine Sessions + Memory Bank for the project; confirm `VertexAiMemoryBankService` connects from the Orchestrator.
- Implement `RetrieveMemories` (similarity-search retrieval) at session start, injected into the Orchestrator's system context via a `PreloadMemoryTool` or equivalent.
- Implement the `session.ended` → Pub/Sub → Eventarc → Cloud Run Job trigger chain (this is the exact asynchronous-invocation pattern documented in Google's own ADK codelabs — follow it closely rather than improvising the event wiring, since IAM scoping on Eventarc triggers is easy to get subtly wrong).

### Day 6 — Profile Synthesizer
- Build the Profile Synthesizer as a Cloud Run Job: `LoopAgent` with Generator/Critic sub-agents, reading recent `feedbackEvents`, writing via `GenerateMemories` (bulk) or `CreateMemory` (targeted, Critic-approved facts).
- Write the Firestore `profileSnapshot` read-through cache so the UI never calls Memory Bank directly.
- **Scripted validation moment**: run one full session, force-trigger the synthesizer (don't wait for the real async delay during dev), start a second session, and confirm the Orchestrator's behavior visibly changes based on the new profile. This exact before/after is the centerpiece of the demo video — get it working now, not on Day 9.

**Deliverable checkpoint:** a second session demonstrably behaves differently because of what happened in the first. If this doesn't work by end of Day 6, it takes priority over every UI task in Phase 3 — this is the feature the track brief is actually scoring.

---

## Phase 3 — Surface & Polish (Days 7–8, Aug 27–28)

**Goal: the product looks and feels like the manifest describes, on the surfaces that will actually be shown.**

### Day 7 — Web app UI
- Build the split-pane layout: chat/conversation, Plan Panel, Cognitive Profile card, Transparent Trace toggle (collapsed by default).
- Wire the Clarify Gate's questions to render as tappable chips, not a text prompt — this was flagged in design review as core to the brief's "ask clarifying questions" requirement reading as guidance rather than interrogation.
- Wire the delta view (strikethrough → new) for any user edit to agent output, so the Feedback Ledger's most important signal is visibly captured, not hidden in a backend log.

### Day 8 — Research Cell + one connector + Transparent Trace
- Implement the Research Cell for exactly one scenario branch (e.g., "look up reference examples" inside the wireframe flow): 2 Flash workers fanning out via `ParallelAgent`, one Synthesis node, hard-capped iteration/timeout.
- Wire one MCP connector end-to-end (Google Docs is the recommended choice — it's already MCP-available and directly demoable: "save this deliverable to a Doc").
- Wire the Transparent Trace UI to read the Firestore `traceSpans` mirror and render a collapsible timeline.

**Deliverable checkpoint:** everything in the product manifest's "Session Pillars" (§5 of the manifest) is either fully working or intentionally, visibly out of scope — no half-built features left in an ambiguous state going into the final stretch.

---

## Phase 4 — Submission Assembly (Days 9–10, Aug 29–31)

**Goal: the deliverable checklist, not new features. Nothing new gets built after Day 8 unless something from Phase 1–3 is broken.**

### Day 9 — Architecture diagram, README, cost cleanup
- Render the architecture diagram (from the Technical Architecture doc §2) as a clean visual for the "Best Architectural Design" bonus prize.
- Finalize the README spin-up instructions — test them literally by having a second person (or a clean environment) follow them from scratch.
- Run the cost-cleanup checklist from the hackathon resources: confirm min-instances are 0 where appropriate, delete any test resources, confirm budget alerts are live.
- Write the Devpost text description sections (Features and functionality, Technologies used, Other data sources used, Findings and learnings) — draft these from the Product Manifest and Technical Architecture doc rather than writing them fresh.

### Day 10 — Demo video + final submission
- Record the ~4-minute demo per the shot list already defined in the Product Manifest §12: problem (30s) → value prop (30s) → live demo of Clarify → Plan → edit → delta → second-session profile change (2m15s) → visible proof of GCP (Cloud Run dashboard, Vertex AI logs) (30s) → close (15s).
- **Record it live and unedited where the rules call for that** — the judging criteria explicitly reward "a live, unedited demo," so resist the urge to cut around rough edges; a slightly imperfect live run scores better than a suspiciously smooth edited one.
- Submit: category, hosted project URL, repo URL (with spin-up instructions), architecture diagram, demo video, text description.
- If time remains: bonus-point items — a short build-log blog post (can be adapted directly from this implementation plan and the architecture doc) and a social post with `#AllThingsAgenticHackathon`.

---

## Risk Log (carried from the Product Manifest, with day-level mitigation)

| Risk | Day it must be resolved by | Mitigation |
|---|---|---|
| `adk deploy` / Cloud Run tooling friction | Day 1 | Deploy a trivial service first, before any real code exists |
| Memory Bank preview-stage instability | Day 5 | Firestore-backed profile store behind the same interface exists as a same-day fallback if Memory Bank calls are unreliable |
| Eventarc/Pub/Sub IAM misconfiguration | Day 5 | Follow the documented least-privilege service-account pattern exactly; don't improvise scoping |
| Research Cell cost runaway | Day 8 | Hard caps (max 4 workers, Flash-only, wall-clock timeout) built in from first implementation, not added after a scare |
| Demo doesn't clearly show GCP usage | Day 10 | Script the Cloud Run/Vertex AI console shots into the video plan now, don't leave it to be improvised while recording |
| Running out of time for the video/README | Days 9–10 reserved and protected | No new features scheduled after Day 8; Phase 4 is deliberately feature-frozen |

---

## What "done" looks like on Aug 31

A judge can: watch a 4-minute unedited video showing a real clarifying-question exchange, a visible Plan Panel, a visible edit-to-delta-to-profile-update chain, and live Cloud Run/Vertex AI console evidence; open a public repo with a README that actually stands up the project; and view a clean architecture diagram that matches what's in the video. Everything else — the browser extension, the connector marketplace, the mobile app, the Teams tier — belongs to the roadmap in the Product Manifest, not to this ten-day window.

---

*See also: **AllTheWay-A2A-and-Platform-Plan.md** — the phased plan for A2A at every
internal boundary, the Research Cell, Voice, streaming, connectors, and roadmap phases 5–10.*
