# AllTheWay — Production Implementation Roadmap
### Full-scope delivery plan: all four pillars (Collaborative Partner, Voice, Autonomous Watchers, Enterprise Trust), all surfaces, production-grade

*Updated to reflect Product Manifest v2's unified-tracks scope. Ten phases (was eight) — Voice and Autonomous Watchers are now dedicated phases rather than folded into surface/connector work, and Enterprise Trust foundations are pulled forward into Phase 1 rather than starting cold in a later phase.*

---

## 0. How this roadmap is structured

The hackathon submission remains **Milestone 1.1** inside Phase 1 — a real early checkpoint proving the core Collaborative Partner loop, not the scope ceiling. Everything in Product Manifest v2 gets built: conversational personalization, voice, autonomous follow-through, and enterprise-grade governance, as one coherent product rather than three bolted-together feature sets.

Ten phases, each with a stated exit criterion — a phase ends when its criterion is met, not when a calendar date arrives. Durations remain engineering-week ranges assuming a core team of roughly 6–9 people, scaling to more once Voice and Watchers add real surface area (see §12, team notes). Several phases overlap substantially rather than running fully serial — the table below states each phase's primary dependency so overlap opportunities are visible.

---

## 1. Phase Overview

| Phase | Focus | Duration (eng-weeks) | Depends on | Exit criterion |
|---|---|---|---|---|
| 1 | Foundation & Core Orchestration Engine | 7–9 | — | Clarify → Plan → Feedback → Profile loop is correct, observable, deployed, and every internal service already runs under least-privilege Agent Identity |
| 2 | Memory & Personalization at Production Grade | 4–6 (overlaps Phase 1 tail) | Phase 1 | Cognitive Profile is accurate, editable, explainable, doesn't drift or over-fit |
| 3 | Voice Conversation | 6–8 (starts once Phase 1 exits) | Phase 1 | Natural spoken conversation, function-calling, and the confirm-summary gate work reliably on mobile + desktop |
| 4 | Autonomous Watchers | 6–8 (overlaps Phase 3) | Phase 1, Phase 2 | A Watcher runs unattended end-to-end, produces the same Plan Panel/Feedback Ledger trail a live session would, and respects its autonomy ceiling every time |
| 5 | Multi-Surface Expansion | 10–14 | Phase 1; voice integration depends on Phase 3 | Web, mobile, browser extension, desktop companion all read/write one shared identity, profile, and (on mobile/desktop) voice session |
| 6 | Connector & MCP Ecosystem | 6–8 (overlaps Phase 4–5) | Phase 1 | Third-party MCP servers registrable without redeploy; 5+ first-party connectors live, serving both live sessions and Watchers |
| 7 | Enterprise-Grade Trust & Governance (full) | 6–8 | Phase 1's identity foundations, Phase 4, Phase 6 | Formal security review sign-off; Agent Registry, Gateway, guardrails, and audit trace are complete, not just present |
| 8 | Monetization & Growth Infrastructure | 4–6 (overlaps Phase 6–7) | Phase 5, Phase 6 | Free/Plus/Team tiers billed correctly, including voice-minute and Watcher-run metering, enforced at the gateway |
| 9 | Scale, Reliability & Multi-Region | 6–8 | Phase 5, Phase 7 | SLOs defined and met under load, including voice-session and Watcher-fanout load; documented DR/failover |
| 10 | GA Launch & Continuous Improvement | Ongoing | All prior | Public launch; roadmap shifts from "build" to "operate and iterate" |

Total to GA: roughly 55–72 engineering-weeks of sequenced work (up from the original 34–44 now that Voice and Watchers are first-class phases rather than folded in) — realistically a 12–18 calendar-month program at the assumed team size, longer if Voice and Watchers are staffed sequentially rather than in parallel with the surface/connector work.

---

## 2. Phase 1 — Foundation & Core Orchestration Engine

**Objective:** every later phase depends on this being architecturally right. This is also where the change from the original roadmap matters most: **Agent Identity is built as production-grade from day one**, not deferred to a later governance phase — because Phase 4 (Watchers) will have agents taking real-world actions unsupervised, and retrofitting zero-trust identity onto a system already running autonomous actions is a materially harder and riskier migration than building it in from the start.

### Workstreams
- **Platform setup**: separate dev/staging/prod GCP projects, Terraform-managed infra, CI/CD to Cloud Run/Cloud Run Jobs.
- **Orchestrator core**: ADK root router, Plan Panel graph, Clarify Gate, `DatabaseSessionService` on Firestore.
- **API Gateway**: Genkit flows, typed schemas, streaming, Firebase Auth verification.
- **Feedback Ledger**: full event schema built to final spec now (accept/edit/reject/reask/skip, signal classification, delta capture).
- **Agent Identity foundations (pulled forward from the old Phase 5)**: dedicated least-privilege service account per Cloud Run service from the first deployment; every internal call IAM-authenticated; Secret Manager for all credentials. This is deliberately more rigorous than a typical MVP's "good enough for now" auth posture — it's the foundation Phase 7 formalizes later, not something Phase 7 builds from scratch.
- **Observability foundation**: OpenTelemetry from the first service; Cloud Trace as source of truth; Firestore trace-mirror for the in-app Transparent Trace UI.

### Milestone 1.1 — Hackathon submission
Proves the core Collaborative Partner loop end-to-end, submitted to the Collaborative Partner track. Valuable independent of competition outcome — it forces Phase 1's hardest decisions to be made and validated early.

### Milestone 1.2 — Core loop hardening
Open-ended goal handling (not one scripted scenario), Clarify Gate false-positive/negative tuning, real session resumability under container recycling.

### Exit criterion
The Clarify → Plan → Feedback loop works for open-ended goals, survives container recycling, every span is traced end-to-end, and every service-to-service call in the system is already running under a scoped, least-privilege identity rather than a shared or overly broad one.

---

## 3. Phase 2 — Memory & Personalization at Production Grade

**Objective:** unchanged from the original roadmap — the Cognitive Profile is the product's core moat and needs to be trustworthy under real, messy, multi-week usage, not just demo-plausible. See original workstream detail: Profile Synthesizer eval harness, signal-quality tuning, Preference Card CRUD/versioning, cross-session memory scoping, data lifecycle (retention/deletion/export).

### What's new in v2
- Memory scoping now has to account for **three memory-writing sources**, not one: live text/voice sessions, and Watcher runs. A Watcher acting on an inbox shouldn't silently write profile-shaping memories with the same weight as a deliberate, user-confirmed correction in a live session — the Profile Synthesizer's signal-weighting needs a source-aware dimension added in this phase, not patched in later once Watchers exist.

**Amendment (2026-08-28):** Watchers do not write the Cognitive Profile. The source-aware dimension is an absence of a watcher writer, not a score. Preference memory is the Firestore ledger, not Vertex AI Memory Bank. See [Memory Layer Plan](AllTheWay-Memory-Layer-Plan.md).

### Exit criterion
Unchanged: a test-user panel rates the Cognitive Profile as accurate and non-creepy at a defined bar (e.g., >85% confirmed-accurate, <5% overreach), with full view/edit/delete and verified propagation — now validated across all three memory-writing sources, not just live sessions.

---

## 4. Phase 3 — Voice Conversation

**Objective:** natural, low-latency spoken interaction with a hard confirm-before-action gate, per Product Manifest v2 Pillar 2.

### Workstreams
- **Gemini Live API integration**: 3.1 Flash Live via the Live API, audio-to-audio, wired into the Orchestrator's tool-calling surface so spoken requests trigger the same function calls a text request would — not a separate voice-only code path.
- **Confirm-summary UX**: the spoken equivalent of the Plan Panel — every action with a real-world side effect gets a summarized spoken confirmation before execution, with tested, deliberately-chosen microcopy (the difference between "confirmed," "saved," and "I'll verify that" is a real UX decision, not filler).
- **Graceful degradation**: low-confidence transcription routes to a clarifying follow-up or a text fallback rather than acting on a guess.
- **Session continuity**: voice sessions read/write the same Firestore session state and the same Firestore preference ledger as text sessions — a user can start a request by voice and finish reviewing it as text without repeating context. See [Memory Layer Plan](AllTheWay-Memory-Layer-Plan.md).
- **Architecture constraint handled explicitly**: current Live models don't reliably support live hand-offs between differently-instructed sub-agents mid-call. Voice sessions route through a single Orchestrator context with tool-calling; anything that would need Research Cell-style multi-agent work gets queued as a visible, approvable Plan Panel step instead of attempted as an invisible mid-call delegation. Re-evaluate this constraint each time the Live API model generation updates.
- **Voice-specific Feedback Ledger events**: confirmations, corrections, and declines from voice turns are logged with the same structure as text events, not a separate log.

### Exit criterion
A user can complete a real task (e.g., reschedule a meeting and draft a follow-up) entirely by voice, receives an accurate spoken summary before anything executes, and the resulting session is indistinguishable in the Plan Panel/Feedback Ledger from one that started as text.

---

## 5. Phase 4 — Autonomous Watchers

**Objective:** event-driven, unattended, multi-app task completion, per Product Manifest v2 Pillar 3 — built on the same graph machinery as live sessions, not a separate simplified engine.

### Workstreams
- **Trigger ingestion**: inbox polling/push, calendar webhooks, Cloud Storage file-drop triggers, generic webhook ingestion — all landing on the existing Pub/Sub + Eventarc pattern already proven for the Profile Synthesizer's async trigger in Phase 1/2.
- **Watcher runtime**: each Watcher execution instantiates the same ADK Orchestrator graph a live session would use; the Clarify Gate becomes a queued notification (not a blocking chat turn) when no user is actively present, per FR-W3.
- **Autonomy ceiling enforcement**: per-category action permissions (draft-only / review-required / auto-send), with irreversible/high-stakes categories (external sends, financial actions, deletions) hard-floored at "review required" and not user-reducible below that floor without an auditable org-admin waiver (this ties directly into Phase 7's governance work — build the waiver's audit trail now, formalize the review process later).
- **Guardrail integration**: since Watchers process untrusted external content (inbound emails, scraped pages) autonomously, the Model Armor-equivalent prompt-injection/PII screening from Phase 1's identity foundations gets its first real adversarial testing here, ahead of Phase 7's formal red-team pass.
- **Watcher management UI**: create/edit/pause/delete, visible run history, in the same interface as live sessions — not a separate automation dashboard.

### Exit criterion
A Watcher runs unattended for a real multi-day scenario (e.g., watch an inbox, draft proposals from past work), every run is fully visible in the Plan Panel/Feedback Ledger, and a deliberately-triggered prompt-injection attempt via a fake inbound email is caught by the guardrail rather than reaching an external action.

---

## 6. Phase 5 — Multi-Surface Expansion

**Objective:** "your companion," not four separate apps. Unchanged in structure from the original roadmap, with one addition: mobile and desktop now carry the voice experience from Phase 3, not just text.

### Workstreams
- **Web app**: full design system (session library, split-pane workspace, Plan Panel, Preference Card, Transparent Trace, Watcher management).
- **Mobile (iOS + Android)**: capture-first flows, push notifications for Watcher clarifications and long-running-node completions, condensed Plan Panel, and now **voice as a primary input mode**, not just typed capture.
- **Browser extension (Manifest V3)**: side-panel architecture, explicit page-content consent gate.
- **Desktop companion**: local file-aware watcher (structured events only), and now the second surface (with mobile) carrying voice conversation.
- **Identity/session continuity**: one Firebase Auth identity, one Firestore Cognitive Profile, verified across text, voice, and Watcher-originated sessions on every surface. Watchers read the profile; they do not write it.

### Exit criterion
A single test account can move a session across all four surfaces mid-task — including switching from a voice turn on mobile to reviewing the same Plan Panel on web — without re-explaining context, and each surface passes its own accessibility review (WCAG AA minimum).

---

## 7. Phase 6 — Connector & MCP Ecosystem

**Objective:** unchanged in structure — move from hardcoded connectors to a real marketplace — with the addition that connectors now serve two consumers, live sessions and Watchers, and need to be designed for both from the start.

### Workstreams
- First-party connectors to production quality (Docs, Gmail, Calendar, Drive, GitHub, Notion), each with real OAuth and its own MCP server on Cloud Run.
- Gateway layer (API Gateway → MCP server pool) with centralized auth, rate-limiting, audit logging.
- Third-party MCP registration with a review/trust model.
- Marketplace surface: discovery, permissions management, per-connector usage visibility — now showing usage from both live sessions and Watcher runs distinctly, since a user needs to be able to see "what did my automation touch" separately from "what did I ask for directly."

### Exit criterion
A user can register a new MCP-compliant connector without a core-system deploy; at least five first-party connectors are in production with least-privilege OAuth scoping and are usable by both live sessions and Watchers.

---

## 8. Phase 7 — Enterprise-Grade Trust & Governance (full)

**Objective:** where AllTheWay becomes something a real enterprise security review can approve. This phase is lighter than it would otherwise be, because Phase 1 already built the identity foundations and Phase 4 already put guardrails under real adversarial load — this phase formalizes, audits, and completes that work rather than starting it cold.

### Workstreams
- **Agent Registry**: real catalog for org-shared connectors, Watcher templates, and any future specialist agents — versioned and discoverable.
- **Agent Identity — formalization**: the least-privilege posture from Phase 1 gets a full audit, documentation for a buyer's security team, and SSO/org IdP integration for Team-tier customers.
- **Agent Gateway**: multi-tenant org policy enforcement layered onto the per-user rate-limiting already in place.
- **Guardrails — formal red-team pass**: adversarial testing beyond Phase 4's initial adversarial validation, covering prompt injection, tool poisoning, and PII leakage across every connector and Watcher trigger source.
- **Observability & audit**: retention policy and access controls on audit logs formalized for compliance, not just functionally present.
- **Compliance groundwork**: SOC 2 Type I readiness process, if enterprise sales are a near-term goal.

### Exit criterion
A third-party security review (internal red team or external auditor) signs off on identity, gateway, and guardrail architecture; audit logs answer "what did this agent do and why" — including for Watcher-originated actions — for any org admin with the right role.

---

## 9. Phase 8 — Monetization & Growth Infrastructure

**Objective:** unchanged in structure, updated in metering scope — Free/Plus/Team tiers now bill for voice minutes and Watcher-run volume, not just session count.

### Workstreams
- Billing integration (Stripe or equivalent) with full subscription lifecycle.
- **Usage metering enforced at the gateway**, now covering: session concurrency, Research Cell/Pro-tier usage, **voice minutes** (Live API has real per-minute cost), and **Watcher-run volume** (mirroring how Zapier meters per-task) — all server-side, not client-gated.
- Team/org tier: seat management, shared connector registry, org-level Watcher autonomy-ceiling policy controls (the audit-tracked waiver from Phase 4), admin visibility into Transparent Trace.
- Growth instrumentation: activation funnel, retention cohorts, and a standing dashboard tracking whether Cognitive Profile accuracy correlates with retention — the metric that validates the whole differentiation thesis.

### Exit criterion
A user can subscribe and be correctly billed and rate-limited across all metered dimensions (sessions, voice minutes, Watcher runs); org admins can manage seats, Watcher policy, and compliance-relevant trace data without manual intervention.

---

## 10. Phase 9 — Scale, Reliability & Multi-Region

**Objective:** unchanged in structure, expanded load profile — voice sessions and Watcher fanout both need their own load-testing pass, since they have different traffic shapes than text sessions (voice is latency-sensitive and stateful per-call; Watchers can spike in bursts when a trigger source floods, e.g., a busy inbox after a weekend).

### Workstreams
- Load testing across all four traffic shapes: text sessions, voice sessions, Research Cell fanout, and Watcher trigger bursts.
- SLOs instrumented and alerted (p95 Clarify Gate response, p99 Plan Panel generation, voice round-trip latency, Watcher trigger-to-first-action latency).
- Multi-region DR posture: Firestore backup/restore tested, Live API regional availability accounted for in the DR plan. Memory Bank region failover is relevant only if `MEMORY_BANK_RESOURCE` is set in production.
- Cost-per-active-user tracking, now broken out by pillar (text session cost, voice-minute cost, Watcher-run cost) so the Phase 8 pricing model can be validated against real infrastructure spend per capability, not just in aggregate.

### Exit criterion
Documented SLOs met under load across all four traffic shapes; a DR drill has been run at least once with a documented recovery process.

---

## 11. Phase 10 — GA Launch & Continuous Improvement

**Objective:** the roadmap shifts from a build program to an operating cadence.

- Public launch across all surfaces and all four pillars, with growth instrumentation already live.
- Standing cadence: Profile Synthesizer quality review, connector/Watcher-template marketplace growth review, SLO dashboard review, and a periodic guardrail red-team refresh (threat patterns evolve; a one-time Phase 7 pass isn't sufficient indefinitely).
- Roadmap beyond GA (new specialist agents via A2A, additional connectors, deeper enterprise features, new Watcher trigger types) is genuinely additive — the architecture was built so none of this requires re-architecture.

---

## 12. Team Notes

The original 6–9 person estimate was sized for the three-pillar (Collaborative Partner-only) scope. With Voice and Watchers as first-class phases, realistic additions:
- A dedicated voice/conversational-UX engineer (or a backend engineer with real Live API/WebRTC experience) for Phase 3 — this is a genuinely different skill set from the text-based agent orchestration work.
- Additional backend capacity for Phase 4's trigger-ingestion and Watcher runtime work, since it's substantial enough to bottleneck the same engineers who are also carrying Phase 1's core loop hardening if not staffed separately.
- Security/compliance support moves from "fractional, mostly Phase 7" to "meaningfully involved from Phase 1 onward," given the identity-first approach.

---

## 13. Cross-Cutting Workstreams (run throughout, not phase-bound)

- **Security review**: gated at the end of Phase 1 (identity foundations), Phase 4 (Watcher guardrails, first adversarial pass), Phase 6 (connector OAuth), and Phase 7 (formal enterprise review) — four checkpoints, not one.
- **Data privacy/legal**: PII handling in the Firestore Cognitive Profile, voice-recording/transcript retention policy (new in v2 — voice data has its own regulatory profile in many jurisdictions), browser-extension page-content consent, desktop file-access scoping, Watcher-triggered external-communication policy, and Team-tier admin visibility model — each reviewed before its respective phase ships.
- **QA**: an eval harness for agent behavior (not just unit/integration tests) from Phase 1 onward, extended in Phase 3 to voice-specific eval (transcription accuracy, confirm-summary correctness) and in Phase 4 to Watcher eval (did it stay within its autonomy ceiling, every time, under adversarial input).
- **SRE/on-call**: a real rotation and incident process by Phase 5 at the latest — voice and Watchers both mean real users depend on uptime in ways a text-only MVP doesn't.

---

## 14. Risk Register (v2, production-scope)

| Risk | Phase most exposed | Mitigation |
|---|---|---|
| Cognitive Profile over-fits or feels "creepy" | Phase 2 | Formal eval harness, defined accuracy/overreach bar, now source-aware across text/voice/Watcher signals |
| Native mobile + browser extension scope balloons the timeline | Phase 5 | Explicit build-vs-buy on cross-platform framework; each surface has its own exit criterion |
| Voice confirm-summary UX undermines the "just talk to it" value prop with too much friction | Phase 3 | Pre-authorizable low-stakes action categories; irreversible-action floor never removable |
| Watchers act on adversarially-crafted external content (prompt injection via email/web content) | Phase 4 | Guardrail screening mandatory on all Watcher-ingested content from first implementation, tested adversarially before Phase 4 exits, not just at Phase 7 |
| Enterprise trust/governance work is underestimated | Phase 7 | Identity foundations already built in Phase 1 substantially de-risk this; budget real calendar time for the formal review cycle regardless |
| Billing/metering bugs across four metered dimensions (sessions, voice minutes, Research Cell, Watcher runs) | Phase 8 | Usage enforcement server-side at the gateway from the start, tested against every tier boundary explicitly, not just the simplest one |
| Serverless architecture hits a scaling wall under voice or Watcher-burst load specifically | Phase 9 | Load testing explicitly covers all four traffic shapes, not just text-session concurrency |
| Total scope (four pillars, ten phases) is materially larger than originally scoped, risking indefinite timeline creep | All phases | Each phase retains its own hard exit criterion; phases are gated on criteria being met, not on calendar dates, but the Phase Overview table's duration estimates should be revisited quarterly against actual velocity, not treated as fixed |

---

*This roadmap should be read alongside Product Manifest v2 (feature and requirements source of truth) and the AllTheWay Technical Architecture document (system design source of truth, updated for Voice and Watcher architecture). The original 10-day sprint plan remains valid as the execution detail for Milestone 1.1 specifically — it still targets the Collaborative Partner-only MVP scope by design, since ten days was never going to fit all four pillars, and shouldn't be expanded to try.*
