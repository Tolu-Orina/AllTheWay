# AllTheWay — Product Manifest v2
### Your collaborative companion — now unifying all three hackathon tracks

*Supersedes the original Product Manifest. Scope is intentionally expanded past the original Collaborative Partner-only framing, per direction: build the full-value product, not a track-constrained one.*

---

## 0. What changed, and why

The original manifest scoped AllTheWay to the Collaborative Partner track alone: stateful dialogue, persistent memory, visible personalization. That's still the core of the product's identity — but treating it as the *ceiling* of the product was itself a form of scope-limiting that doesn't serve users well. Two more rounds of research made the gap obvious:

1. **The other two tracks aren't competing scope — they're missing capability.** The Taskmaster track's brief ("watching for a change, figuring out what needs to happen next, interacting with different apps to get the job done, without you guiding each step") describes something users genuinely want from a companion they trust: not just conversation, but real autonomous follow-through. The Fortified Enterprise Fleet track's brief (discovery, audit, identity, guardrails, observability at scale) describes what makes a personal companion safe to adopt at a company, not just as an individual. A companion that only does one of these three things is a lesser product than one that does all three *coherently*.
2. **The current market is already validating each piece separately, at scale.** Zapier Agents and Make's Maia have proven that goal-oriented, multi-app autonomous agents ("qualify this lead and update the CRM") are a real, monetizable category — Zapier alone reports 9,000+ connected apps and enterprise-grade guardrails already in production. Gemini's own Live API (3.1 Flash Live, GA as of 2026) has proven that natural, low-latency, function-calling voice conversation is production-ready, not a novelty. Neither of these is speculative — they're existing categories AllTheWay can absorb rather than compete against from outside.

**The unifying idea:** AllTheWay is not "a Collaborative Partner app that also does some automation." It's one companion with three coherent capabilities that reinforce each other — it **talks with you** (voice), it **watches and acts for you** (autonomy), and it **remembers and adapts to you** (personalization) — all of it visible, auditable, and safe enough for an enterprise to trust. The Cognitive Profile and Feedback Ledger from the original manifest become the *connective tissue* across all three: what the voice conversation learns about you shapes what the watchers are allowed to do unsupervised, and what the watchers do gets folded back into the same profile the conversational agent uses next time you talk to it.

---

## 1. What AllTheWay replaces (competitive consolidation)

A user doing all of this today needs several separate tools. AllTheWay is positioned to collapse them into one:

| Today, a user has | AllTheWay's equivalent |
|---|---|
| A voice assistant (Siri/Gemini/ChatGPT Advanced Voice) for quick spoken requests | Native voice conversation, but with persistent memory and a visible action-item confirmation step the consumer voice assistants don't have |
| A no-code automation tool (Zapier Agents, Make) for "watch this, then do that" workflows | Autonomous Watchers — the same event-driven, multi-app autonomy, but reporting through the same Plan Panel/Feedback Ledger as everything else, instead of living in a separate dashboard the user has to remember to check |
| A personal notes/planning app (Notion, Reflect, Motion) for tracking ongoing work | Sessions + Plan Panel, with the added property that the plan was built collaboratively with an agent that asked clarifying questions, not typed alone |
| A settings page full of "AI preferences" toggles that don't actually reflect real usage | The Cognitive Profile — built from what you actually did and corrected, not from a form you filled out once |

This is the pitch to a user: instead of a voice assistant *and* an automation tool *and* a planning app *and* hoping they all somehow share context (they don't, today, anywhere), there's one companion, one memory, one place it all shows up.

---

## 2. Pillar 1 (existing, retained): Collaborative Partner — Guided, Personalized Dialogue

Unchanged in substance from the original manifest — the Session Graph, Plan Panel, Clarify-Before-Commit gate, Feedback Ledger, Cognitive Profile, Research Cell, Transparent Trace. See the original Product Manifest for full detail; summarized here for context since the other two pillars build directly on this foundation.

---

## 3. Pillar 2 (new): Voice — Talk to It Like a Person, Not a Form

### 3.1 What it does
A user can simply talk to AllTheWay — no typing, no menu navigation. They describe what they want in natural, possibly rambling, real conversation. AllTheWay listens, asks clarifying questions *in voice* where needed, and — critically — **before taking any action, it confirms back a summarized set of action items** in plain language ("Here's what I've got: reschedule Thursday's client call to Friday afternoon, and draft a follow-up email to the team about the change — should I go ahead?"). Nothing executes on a spoken request until the user confirms the summary, unless the user has explicitly pre-authorized that category of action (see Watchers, Pillar 3).

### 3.2 Why this design, specifically
Current voice-AI production guidance is blunt about this: **"always confirm before executing irreversible actions — one extra turn is cheaper than a rollback."** This isn't a nice-to-have UX flourish, it's the difference between a voice assistant users trust and one they stop using after it does the wrong thing once. AllTheWay's confirm-with-summary step is the voice-native equivalent of the Plan Panel — the same "show your work before you act" principle the whole product is built around, just spoken instead of rendered.

### 3.3 Technical basis
- Built on **Gemini Live API** (3.1 Flash Live, GA), which processes audio-to-audio directly rather than the older speech-to-text-to-LLM-to-text-to-speech pipeline — this is what makes the conversation feel like a conversation (preserving tone, pacing, interruption handling) instead of a laggy voice-command interface.
- **Function calling from voice**: Flash Live scores highest in the field on function-calling-from-spoken-instruction benchmarks as of its release — the "reschedule Thursday's call" example above is a direct tool call, not a text-intermediary hack.
- **Affective dialogue & proactive audio**: the model natively reads tone/emotion/pace from raw audio and can act as a "silent co-listener" rather than interrupting on every pause — relevant for AllTheWay's guided-learning use case (a user thinking out loud while working through a dense document shouldn't be interrupted every three seconds).
- **Continuous memory across modalities**: a voice session and a subsequent text session are the same Cognitive Profile, the same session state — a user can start describing a task by voice on mobile and finish reviewing the Plan Panel by text on web without repeating themselves.
- **Known architecture constraint to design around**: current-generation Live models do not reliably support switching between differently-instructed sub-agents mid-voice-session. AllTheWay's voice sessions therefore route through a single, tool-equipped Orchestrator context rather than attempting live hand-offs to specialist sub-agents mid-conversation; anything that genuinely needs Research Cell-style multi-agent work is queued as a Plan Panel step the user sees and approves after the voice turn, not executed as an invisible mid-call delegation. This is a real technical limit as of today, not a design preference, and should be re-validated as Live API models mature.
- **Confirmation microcopy matters**: production voice-UX guidance is specific that words like "confirmed," "saved," and "I'll verify that" carry different weight in voice than in a UI label — AllTheWay's voice confirmation language is designed and tested as its own artifact, not auto-generated from the text-UI copy.

### 3.4 Functional requirements (voice)
- FR-V1: The system shall support real-time, low-latency spoken conversation as a first-class input/output mode on mobile and desktop, and as an available mode on web.
- FR-V2: Before executing any action with a real-world side effect (sending a message, creating an event, modifying a file), the system shall speak a summarized confirmation of the action(s) and require explicit user confirmation, unless the action falls under a category the user has pre-authorized (see FR-W4).
- FR-V3: Voice sessions shall write to and read from the same Cognitive Profile and session state as text sessions — no separate "voice memory."
- FR-V4: The system shall degrade gracefully to text when voice input confidence is low, rather than acting on a low-confidence transcription.
- FR-V5: Voice interactions shall be logged to the Feedback Ledger with the same structure as text interactions (what was confirmed, what was corrected, what was declined).

---

## 4. Pillar 3 (new): Autonomous Watchers — Taskmaster-Grade Follow-Through

### 4.1 What it does
A user can hand AllTheWay a standing instruction, not just a one-time task: *"Watch my inbox for client inquiries and draft a proposal from my past work when one comes in,"* or *"When a meeting transcript lands in this folder, pull out action items and create tasks."* AllTheWay then runs this autonomously, event-driven, in the background — watching a trigger source (inbox, calendar, webhook, file drop, meeting transcript) and executing a bounded, pre-scoped sequence of actions across connected apps, exactly the Taskmaster track's brief.

### 4.2 Why this doesn't compromise the trust story
The obvious risk of adding "does things without you watching" to a product whose whole differentiation is *visibility* is that the two ideas seem to fight each other. They don't, if built correctly — and current best practice from the automation-platform space (Zapier's own "AI Guardrails," audit logs, and managed credentials for its Agents product) confirms this is a solved design problem, not a novel risk:
- Every Watcher run produces a Plan Panel entry and Feedback Ledger events **exactly like a session the user drove directly** — a Watcher's work is not a separate, unaudited dashboard; it shows up in the same place everything else does.
- Watchers have an explicit, user-set **autonomy ceiling** per category of action (see FR-W4) — e.g., "draft but don't send" vs. "send without asking" — and that ceiling is itself part of the Cognitive Profile, adjustable the same way any other preference is.
- Irreversible or high-stakes actions (sending external communication, financial actions, deleting data) default to requiring confirmation regardless of the Watcher's general autonomy setting, and this default is not user-overridable below a defined floor — mirroring the "always confirm before irreversible actions" principle from the voice research, applied to background automation as well.

### 4.3 Technical basis
- Event-driven trigger sources map directly onto the existing serverless architecture: Pub/Sub + Eventarc already handle the `session.ended` → Profile Synthesizer pattern; Watchers extend the same pattern to external triggers (inbox polling/push, calendar webhooks, file-drop notifications via Cloud Storage triggers, generic webhook ingestion).
- Each Watcher run instantiates the same ADK Orchestrator graph a live session would — a Watcher is not a separate, simpler code path, it's the same Plan Panel/Clarify Gate/Feedback Ledger machinery triggered by an event instead of a chat message. (The Clarify Gate becomes a queued notification rather than a blocking chat turn when no user is actively present — see FR-W3.)
- This directly follows the pattern validated at scale by Zapier Agents and Make's Maia — goal-oriented, multi-app, judgment-based automation, distinguished from traditional rigid trigger-action "Zaps" by the same LLM-reasoning-over-fixed-rules shift AllTheWay's whole architecture is built around anyway.

### 4.4 Functional requirements (watchers)
- FR-W1: Users shall be able to define a Watcher: a trigger source, a goal, and a scope of connectors/actions it's permitted to use.
- FR-W2: Every Watcher execution shall produce a Plan Panel entry and Feedback Ledger events, visible in the same interface as user-initiated sessions.
- FR-W3: When a Watcher's Clarify Gate would trigger (ambiguous situation) and no user is actively in-session, the system shall pause that run and send a notification requesting clarification, rather than guessing or blocking indefinitely.
- FR-W4: Users shall be able to set a per-category autonomy ceiling (e.g., "draft only," "send after my review," "send automatically") for each Watcher, with irreversible/high-stakes action categories (external sends, financial actions, deletions) defaulting to "review required" and not reducible below that floor by the user alone (an org admin, under Pillar 4, may formally waive this with an auditable justification for enterprise use cases).
- FR-W5: Watchers shall be pausable, editable, and deletable at any time, with a visible run history.

---

## 5. Pillar 4 (elevated from roadmap to core): Enterprise-Grade Trust & Governance

### 5.1 What changed
The original manifest treated Fortified Enterprise Fleet patterns (Agent Registry, Identity, Gateway, Model Armor, Observability) as a **post-hackathon extension**, reused *if* an enterprise track ever became relevant. Given the directive to build the full-value product now, this is promoted to a **core architectural pillar**, not a stretch goal — because Pillar 3 (autonomous Watchers acting across connected apps) makes this load-bearing rather than optional: a product that can send emails and modify files on a schedule, unsupervised, needs enterprise-grade guardrails *for individual users too*, not just for org deployments.

### 5.2 What it provides
- **Agent Registry**: every specialist agent and Watcher template AllTheWay ships (and, later, that an org's own team builds) is discoverable, versioned, and auditable in a real catalog — not a hardcoded list buried in code.
- **Agent Identity**: zero-trust, least-privilege service-to-service auth between every internal component (Orchestrator, Research Cell, Profile Synthesizer, Watcher runtime, connectors) from the first production deployment, not retrofitted later.
- **Agent Gateway**: a single policy-enforcement point in front of the connector layer — rate limits, scoped permissions, and (for org deployments) org-level policy, in one place rather than duplicated per connector.
- **Model Armor-equivalent guardrails**: inline defense against prompt injection (especially relevant now that Watchers process untrusted external content — inbound emails, web pages — autonomously), tool poisoning, and PII leakage before anything reaches Memory Bank or an external action.
- **Observability**: the Transparent Trace feature from Pillar 1 *is* the consumer-facing surface of the same audit-log/reasoning-chain-trace infrastructure an enterprise security team would require — one investment serves both the individual-trust UX and the enterprise-audit requirement.

### 5.3 Why this is a genuine differentiator, not just compliance box-checking
No current Taskmaster-style tool (Zapier, Make) is built around visible, per-user-editable preference modeling, and no current Collaborative Partner-style tool (Claude Cowork, ChatGPT Work) is built with enterprise-grade agent identity and audit trail from day one. AllTheWay having all three from the start — voice, autonomous follow-through, and governed trust — is the actual "super-collaborative, taskmaster, enterprise-ready" positioning: not three separate feature sets bolted together, but one trust model (Cognitive Profile + Feedback Ledger + Transparent Trace + Agent Identity) that happens to power all three capabilities.

---

## 6. Updated System Diagram (delta from the original architecture)

```
[Web] [Mobile] [Extension] [Desktop]  ← voice input/output added on mobile + desktop
        |
   Firebase Auth (Agent Identity–scoped tokens)
        |
   API Gateway (Genkit) ── Gemini Live API session handling (voice)
        |
   Orchestrator (ADK) ──── Clarify Gate ──── Plan Panel graph
        |                                        |
        |                                  Confirm-Summary step (voice + text)
        |
   ┌────┴─────────────┬─────────────────┬─────────────────┐
   Research Cell   Watcher Runtime   Profile Synthesizer   Agent Gateway
   (bounded swarm) (Eventarc-triggered,  (Cognitive Profile)  → Connector pool
                    same graph machinery                       (MCP, Model Armor
                    as live sessions)                           screened)
        |
   Memory Bank (shared across voice, text, and Watcher-originated sessions)
        |
   Agent Registry + Identity + Observability (Transparent Trace, audit logs)
```

---

## 7. Updated Monetization

The original three-tier model (Free / Plus / Team) is retained; usage dimensions expand to reflect the new pillars:

- **Free**: 1 active session, weekly profile sync, core connectors, text only, no Watchers.
- **Plus (individual, paid)**: unlimited sessions, daily profile sync, voice conversation included (with a fair-use minutes allowance, since Live API usage has real per-minute cost), 1–3 active Watchers, full multi-surface access.
- **Team/Org**: everything in Plus per seat, plus shared connector registry, org-level Watcher policy controls (the FR-W4 autonomy-ceiling waiver), admin visibility into Transparent Trace and audit logs across the org, and SSO/Agent Identity integration with the org's existing IdP.
- **Voice minutes and Watcher-run volume** become metered dimensions (mirroring how Zapier bills per-task) rather than unlimited-by-default, since both have real, non-trivial marginal infrastructure cost — this needs to be modeled explicitly in the pricing page rather than left implicit.

---

## 8. Updated Risks (delta from the original manifest)

| Risk | Mitigation |
|---|---|
| Voice confirm-summary adds friction that undermines the "just talk to it" value prop | User-tunable: a user can pre-authorize low-stakes action categories (per FR-W4's same mechanism) to skip confirmation, while the floor for irreversible actions never goes away |
| Watchers acting on untrusted external content (inbound email, web pages) get prompt-injected | Model Armor-equivalent guardrail screening is mandatory on all Watcher-ingested external content, not optional per-connector |
| Scope genuinely is much larger now — three tracks' worth of product | This is accepted per explicit direction; the Production Roadmap's phased structure (Phase 1 core loop → Phase 2 memory → Phase 3 surfaces → Phase 4 connectors → Phase 5 enterprise governance → Phase 6 monetization) already sequences this correctly — Pillars 2–4 here map onto roadmap phases rather than requiring a new plan from scratch |
| Live voice + multi-agent delegation hits the documented model limitation | Voice sessions route through a single Orchestrator context with tool-calling rather than live sub-agent hand-offs, with Research Cell-style work queued for user-visible approval instead — re-evaluate as Live API models mature |

---

*This manifest should be read alongside the AllTheWay Technical Architecture document and Production Roadmap — both remain valid in structure; their content should be updated in a follow-up pass to reflect the Voice, Watcher, and elevated Enterprise Trust pillars formalized here.*
