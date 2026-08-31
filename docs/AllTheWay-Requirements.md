# AllTheWay — Requirements Specification

| Field | Value |
|---|---|
| **Document** | Requirements specification (high-level and low-level) |
| **Product** | AllTheWay |
| **Status** | Current as of 29 August 2026 |
| **Authorised by** | [AllTheWay-PRD.md](AllTheWay-PRD.md) |
| **Normative pricing / limits** | `libs/metering` |
| **Normative memory** | [AllTheWay-Memory-Layer-Plan.md](AllTheWay-Memory-Layer-Plan.md) |
| **Normative life** | [AllTheWay-Life-Companion-Design.md](AllTheWay-Life-Companion-Design.md) |

This document is the requirements baseline. The PRD states *why* and *for whom*. This document states *what must be true*. Where a numbered requirement here conflicts with a comment in UI copy, **this document wins**. Where it conflicts with `libs/metering`, **metering wins** for numbers.

---

## 0. How to read this

### 0.1 Layers

| Layer | Prefix | What it is |
|---|---|---|
| Business | **BUS** | Outcomes the company needs |
| User | **USR** | Jobs a persona must be able to complete |
| System | **SYS** | Cross-cutting properties of the whole system |
| Functional (low-level) | **FR-*** | Testable behaviours |
| Non-functional | **NFR-*** | Qualities, not features |

### 0.2 Priority (MoSCoW)

| Tag | Meaning |
|---|---|
| **M** | Must for Plus GA |
| **S** | Should — planned, not a Plus blocker |
| **C** | Could — later ADR |
| **W** | Won’t — refused; listed so they are not reopened as bugs |

### 0.3 Status

| Tag | Meaning |
|---|---|
| **Shipped** | Behaviour exists in the live stack and is guarded by tests or design |
| **Partial** | Pieces exist; the user-visible job is incomplete |
| **Planned** | Specified; not the Plus GA blocker unless marked M |

Status is a snapshot for PM, not a substitute for QA. “Shipped” still requires the acceptance criteria on a clean account.

### 0.4 Traceability

Every **FR** traces to at least one **USR** or **SYS**. Every **USR** traces to a PRD journey or persona. IDs from Product Manifests (FR-V1, FR-D4, …) are **kept** so existing tests and docs stay aligned.

---

## 1. High-level requirements

### 1.1 Business requirements

| ID | Requirement | Priority |
|---|---|---|
| **BUS-1** | AllTheWay shall be sold as one companion (not separate work / home / church products) with four plans: Free, Plus (£18), Team (£32/seat), Max (£60). | M |
| **BUS-2** | Entitlement shall be enforced from Stripe subscription status and tier; a missing or unreadable subscription shall resolve to Free. | M |
| **BUS-3** | Marketing plan copy shall match `libs/metering`. Drift is a defect. | M |
| **BUS-4** | The company shall not acquire paid users until a new account can complete one activation job (cited answer, confirmed calendar write, leave-now from Today, or a learned preference on You) without a seed database. | M |
| **BUS-5** | Sharing of artifacts shall be a Team-and-above entitlement. | M |
| **BUS-6** | Video final render shall not be offered on Free or Plus. | M |
| **BUS-7** | The product shall remain viable at Plus gross margin ≥ 65% at target voice mix; Max full-video use may sit near 60% and shall not be used to justify Plus pricing. | S |
| **BUS-8** | Plus LTV/CAC shall be managed to ≥ 3; paid acquisition shall not scale while 7-day activation is below 40%. | S |
| **BUS-9** | EU-only residency shall not be sold until model-region constraints are decided (open decision). | W until decided |
| **BUS-10** | Marketing shall not name Vertex AI Memory Bank as a platform AllTheWay is “built on” unless `MEMORY_BANK_RESOURCE` is invoked in production. | M |

### 1.2 User requirements

| ID | Actor | Requirement | PRD journey | Priority |
|---|---|---|---|
| **USR-1** | Any adult user | Start work by speaking or typing without creating a session by hand; the session exists because they talked. | First hour | M |
| **USR-2** | Any | Be asked a clarifying question when the request is ambiguous, instead of a guessed plan. | All | M |
| **USR-3** | Any | See the plan before irreversible effects, and choose Yes, No, or Not quite. | 11:30–16:20 | M |
| **USR-4** | Any | After Not quite, see the learned fact on You with evidence, and have the next plan use it. | Memory fitness | M |
| **USR-5** | Any | Revert a learned preference or brand row; the fact shall stop being injected; history shall remain. | You | M |
| **USR-6** | Any | Upload a document, ask about it, and open the passage a claim came from — or be told it could not be grounded. | 09:15 | M |
| **USR-7** | Any | Delete a document and be told that embeddings were removed; later answers shall not use it. | You / documents | M |
| **USR-8** | Maya | See the next twelve hours and “leave in N minutes” on Today without opening Google Calendar. | 07:40, life | M |
| **USR-9** | Maya | Capture a flyer (photo/file) and confirm proposed commitments; nothing is added to the calendar until confirm. | Capture | M |
| **USR-10** | Maya | Filter Today by work / home / church without splitting into three products; unlabeled memory still applies. | Hats | M |
| **USR-11** | Any | Talk in their language, including switching and code-mixing; the companion shall not “tidy” mixed speech. | Voice | M |
| **USR-12** | Any | Define a Watcher, set a ceiling, pause it, and see each run in the same place as a session. | Watchers | M |
| **USR-13** | Any | Trust that an irreversible watcher action cannot bypass review because they set “send automatically.” | Watchers | M |
| **USR-14** | Host | Opt a meeting into live notes; everyone is asked; the agent does not speak. | 10:00 | M |
| **USR-15** | Any | After a call, see proposed commitments from the transcript, not silent sends. | 10:00 | M |
| **USR-16** | Jordan | Generate an image, correct “too much blue,” generate again under that constraint, revert the palette on You. | 11:30–14:00 | M |
| **USR-17** | Jordan | Confirm video with cost; choose draft vs final without picking a model id. | Studio | S |
| **USR-18** | Team user | Share an artifact with a signed-in colleague; they comment; retrieval of the source corpus stays the owner’s. | 16:20 | M (Team) |
| **USR-19** | Any | See usage remaining, upgrade via Checkout, manage plan via Customer Portal. | You | M |
| **USR-20** | Any | Ask to hear a cited concept again; see it on You; the next explanation of it must differ. | 22:00 | M |
| **USR-21** | Any | Use the product in any of the seven UI languages without English fragments. | i18n | M |
| **USR-22** | Any | Recover from a failed turn (retry / edit / manual) instead of a dead end. | Recovery | S |
| **USR-23** | Partner (future) | View-share a day or reminder without a household OS. | Life Phase E | C |
| **USR-24** | Child | Hold an AllTheWay login. | — | **W** |
| **USR-25** | Any | Have the agent speak inside a Google Meet. | — | **W** |

### 1.3 System requirements

| ID | Requirement | Priority |
|---|---|---|
| **SYS-1** | One Firebase identity; one Cognitive Profile; voice, text, and watcher runs share it. Watchers read; they do not write preferences. | M |
| **SYS-2** | The browser shall never hold a model credential or supply a uid that retrieval trusts. | M |
| **SYS-3** | The gateway shall be the only public Cloud Run service. Internal calls shall use A2A with Google-signed identity tokens. | M |
| **SYS-4** | User-owned data shall live under `users/{uid}/`. Collection-group queries are forbidden. | M |
| **SYS-5** | Untrusted content (uploads, images, transcripts, watcher-ingested text) shall be screened fail-closed before a model reads it. | M |
| **SYS-6** | Preferences and passages shall be injected as labelled metadata, never concatenated into the user message. | M |
| **SYS-7** | Irreversible effects shall run only after Confirm (or an auditable org waiver of the floor). | M |
| **SYS-8** | Four memory stores shall stay distinct: preference, working (retrieval), brand, life. | M |
| **SYS-9** | Hats default to unlabeled. Filename shall not infer hat. | M |
| **SYS-10** | Build shall fail if locales, tenant isolation, listed tests, image deps, or plan-table guards fail. | M |
| **SYS-11** | Surfaces: responsive web PWA + Chrome extension. No native apps in this specification. | M |
| **SYS-12** | Google Calendar remains system of record for time; AllTheWay writes time only through confirm. | M |

---

## 2. Low-level functional requirements

Each FR has: statement, priority, acceptance criteria (Given/When/Then or bullets that QA can fail), and traces.

### 2.1 Core loop — FR-CORE

#### FR-CORE-1 Session existence
The system shall persist a session as a consequence of a user turn (text or voice), titled from what was said, without a decorative “New” that creates nothing.

- **Priority:** M · **Traces:** USR-1
- **Accept:** A new account types a request. Sessions list shows that thread after reload. There is no dependency on `seed.ts`.

#### FR-CORE-2 Clarify Gate
Before planning, if the request is ambiguous, the system shall stop and ask. It shall not guess a high-stakes interpretation.

- **Priority:** M · **Traces:** USR-2, SYS-7
- **Accept:** “Do something about the meeting” yields options or a question, not a send. Protocol state is input-required, not a silent plan.

#### FR-CORE-3 Plan visibility
A plan shall be visible as steps the user can read before confirm, including on mobile as a sheet.

- **Priority:** M · **Traces:** USR-3

#### FR-CORE-4 Confirm Gate — three paths
When a plan would have a real-world side effect, the system shall require **Yes**, **No**, or **Not quite**.

| Path | Effect | Learns? |
|---|---|---|
| Yes | Executes allowed actions (see FR-CORE-6) | No |
| No | Nothing runs | No |
| Not quite | Requires `now`; writes correction; replans from their words | Yes |

- **Priority:** M · **Traces:** USR-3, USR-4
- **Accept:** Decline does not write `session.correction`. Confirm without `now` is not a correction. Not quite without `now` is rejected (`missing_now`).

#### FR-CORE-5 Feedback Ledger
Every confirm, decline, and correction shall append a ledger row with the same structure for voice and text (FR-V5). The ledger is append-only.

- **Priority:** M · **Traces:** SYS-1, FR-V5
- **Accept:** Voice Yes and typed Yes both appear. Revert of a preference does not delete ledger history.

#### FR-CORE-6 Yes acts
Yes shall perform at least one real effector in Plus GA: **create a Google Calendar event** when the plan says so, and **persist the plan as an artifact** when the work is a keepable deliverable.

- **Priority:** M · **Traces:** USR-3, BUS-4
- **Accept:** After Yes on “add pickup Thursday 16:00,” Calendar shows the event. Copy shall not say “nothing has run” if the connector ran.

#### FR-CORE-7 Thread persistence
The typed (and displayed voice-plan) thread shall survive reload. Voice transcripts remain a separate opt-in (FR-MEM-9).

- **Priority:** M · **Traces:** USR-1

#### FR-CORE-8 Pause and resume
A session shall survive container recycling and being left for days (historical FR-6).

- **Priority:** M · **Traces:** SYS-1

#### FR-CORE-9 Recovery routing
A failed turn shall offer retry, edit the request, or do it manually. A blank error with no route is a defect.

- **Priority:** S · **Traces:** USR-22

#### FR-CORE-10 Specialists are views
Choosing a specialist shall start that kind of work on the same orchestrator and floor, not a second unaudited agent.

- **Priority:** S · **Traces:** USR-16

#### FR-10 Research isolation *(historical id, retained)*
Research-cell workers shall never emit directly to the user. Only the synthesis node re-enters the parent graph.

- **Priority:** M · **Traces:** SYS-3
- **Accept:** Tests fail if a worker payload is treated as the user-visible note.

---

### 2.2 Voice — FR-V *(manifest v2, retained)*

#### FR-V1 Spoken I/O
Real-time spoken conversation on web (desktop and mobile browsers), as first-class I/O.

- **Priority:** M · **Traces:** USR-11
- **Accept:** Mic on Today and companion. Browser holds no Vertex credential. Transport is the gateway WebSocket.

#### FR-V2 Confirm before side effects
Before executing a real-world side effect, the system shall require explicit confirmation (spoken and/or Yes), unless the action is below the irreversible floor and pre-authorised (FR-W4). Video is never pre-authorised.

- **Priority:** M · **Traces:** USR-3, SYS-7

#### FR-V3 One memory
Voice and text shall read and write the same Cognitive Profile and session state. No separate voice memory.

- **Priority:** M · **Traces:** SYS-1, FR-MEM-1
- **Accept:** `plan_turn` uses `loadTurnContext` (preferences, passages, lookups, thread, struggles).

#### FR-V4 Degrade, don’t guess
Low-confidence or noisy speech shall clarify or fall back to text, not act.

- **Priority:** M · **Traces:** USR-11

#### FR-V5 Ledger parity
Voice confirm / correct / decline shall use the same ledger schema as text, including a modality field.

- **Priority:** M · **Traces:** FR-CORE-5

#### FR-V6 Language follow
The Live session shall not send `language_code`. The model shall mirror the speaker, including code-mixing. The product shall not claim Igbo if the Live list excludes it.

- **Priority:** M · **Traces:** USR-11
- **Accept:** A test asserts `language_code` is absent.

#### FR-V7 Metering
Voice minutes shall be counted from gateway-observed duration, not client-reported duration, and refused when the plan’s allowance is exhausted.

- **Priority:** M · **Traces:** FR-B-2

#### FR-V8 Spoken hang-up
The user shall be able to end the live voice session by saying they are leaving the conversation (goodbye, bye, that’s all, you can stop). The live model shall call `end_this_conversation`. The gateway shall close the same socket Stop closes, after the farewell has been sent. The overlay shall dismiss. Leaving shall not confirm a pending plan, and shall not fire when they asked to stop a task.

- **Priority:** M · **Traces:** USR-11, FR-V2
- **Accept:** A test asserts the tool is declared, is not a read, and closes with `{ closing: hangup }` without a turn event. Barge-in and tool-call cancellation keep the session.

---

### 2.3 Watchers — FR-W *(manifest v2, retained)*

#### FR-W1 Define
A user shall define a Watcher: name, instruction, trigger (`schedule` | `session_ended` | `document_indexed`), optional interval (≥ 60 minutes for schedule), and ceiling.

- **Priority:** M · **Traces:** USR-12
- **Accept:** Interval under 60 minutes is rejected. Empty instruction is rejected.

#### FR-W2 Same trail
Every run shall produce a plan/trace and ledger events visible like a user-driven session (digest + You/running).

- **Priority:** M · **Traces:** USR-12

#### FR-W3 Unattended clarify
If clarify fires and no user is in session, the run shall pause and notify, not guess.

- **Priority:** M · **Traces:** USR-13

#### FR-W4 Ceiling and floor
Ceilings: `draft_only` | `send_after_review` | `send_automatically`. Irreversible categories (external send, financial, delete, **video**) shall not execute unattended. The floor is enforced in the connector gateway / policy library, not only in the UI.

- **Priority:** M · **Traces:** USR-13, SYS-7
- **Accept:** Tests written before the mechanism still fail if a watcher can send/delete/video without review.

#### FR-W5 CRUD
Watchers shall be pausable, editable, deletable, with run history.

- **Priority:** M · **Traces:** USR-12

#### FR-W6 No profile write
Watchers shall not create or update preference rows. Untrusted external content is not evidence about the user.

- **Priority:** M · **Traces:** SYS-1, FR-MEM-3

#### FR-W7 Document-indexed propose only
A document-indexed watcher may **propose** commitments. It shall not create calendar events.

- **Priority:** M · **Traces:** USR-9, SYS-12

---

### 2.4 Documents and retrieval — FR-D *(manifest v3, retained)*

#### FR-D1 Screen before any model
No document or uploaded image is used without screening. A blocked document halts, says so, and never reaches a planner/embedder as trusted text.

- **Priority:** M · **Traces:** USR-6, SYS-5
- **Accept:** Injection-bearing PDF is blocked; user sees a refusal, not a 500.

#### FR-D2 Grounded or silent
Every document-grounded claim shall carry a citation to a retrieved passage, or the agent shall state it could not ground the answer. Citations are a checked field, not prose.

- **Priority:** M · **Traces:** USR-6
- **Accept:** Invented chunk ids are dropped. Chip opens the same text that was in the prompt (no second fetch by uid).

#### FR-D3 Deletion removes embeddings
Deleting a document shall remove its chunks. Copy shall state what was removed.

- **Priority:** M · **Traces:** USR-7
- **Accept:** Retrieve after delete does not return those passages.

#### FR-D4 One-user retrieval *(and sub-requirements)*

| ID | Statement |
|---|---|
| **FR-D4** | Retrieval is scoped to exactly one user. Cross-user retrieval is a breach. |
| **FR-D4a** | Chunks live under a path containing the owner’s uid — never a flat collection with an owner field as the only control. |
| **FR-D4b** | No `collectionGroup` query on documents or chunks. |
| **FR-D4c** | Librarian derives user from a verified scope token. No spoofable `uid` body field. |
| **FR-D4d** | Every retrieved chunk’s owner is asserted before it enters a prompt. Mismatch fails the turn. |
| **FR-D4e** | A share grants an artifact, never a corpus. |

- **Priority:** M · **Traces:** SYS-2, SYS-4
- **Accept:** Isolation tests; `check-tenant-isolation.py` fails the build on collection-group or root `documents` / `documentChunks`.

#### FR-D5 Retrieval inspectable
What was retrieved for a turn shall be inspectable (citations UI and/or trace).

- **Priority:** M · **Traces:** USR-6

#### FR-D6 Size and types
Upload ceiling 25MB. Accepted: PDF, TXT, MD, JPEG/PNG/WebP/HEIC. Photographs are transcribed then screened. Empty files are refused.

- **Priority:** M · **Traces:** USR-6

#### FR-D7 Quota
Stored document count is checked at ingest: Free 5, Plus 200, Team/Max unmetered. Delete frees a slot.

- **Priority:** M · **Traces:** FR-B-3

#### FR-D8 Hat on documents
Hat on upload is optional. Unlabeled (absent) always retrieves. Hat is never inferred from title/filename.

- **Priority:** M · **Traces:** SYS-9, USR-10
- **Accept:** `hat_for_title` does not exist. `school-policy.pdf` uploaded with no picker retrieves under Work.

---

### 2.5 Multimodal / Studio — FR-M *(manifest v3, retained)*

#### FR-M1 Labelled generation
Every generated image and video is labelled as AI-generated in the UI. C2PA/SynthID shall be preserved in the file. The product shall not strip provenance.

- **Priority:** M · **Traces:** USR-16

#### FR-M2 Video confirmation and exclusion
Video generation always requires explicit confirmation with cost stated, at every ceiling. **Never** available to an unattended watcher. A **final** render requires a second confirmation.

- **Priority:** M · **Traces:** USR-17, FR-W4, BUS-6

#### FR-M3 Uploaded images are untrusted
Screened before a model reads them (same composition as FR-S).

- **Priority:** M · **Traces:** SYS-5

#### FR-M4 Brand memory
Visual preferences (palette, density, corners, typography, look) are visible on You and revertible individually. Applied at generate time. A caller cannot pass another user’s style.

- **Priority:** M · **Traces:** USR-16, FR-MEM-5
- **Accept:** “too much blue” → palette; second palette correction revokes the first; empty note writes nothing.

#### FR-M5 Degrade
If the image model is unavailable, the turn shall degrade to a described layout rather than fail entirely.

- **Priority:** S · **Traces:** USR-16

#### FR-M6 Ladder
The user asks for draft or final. They do not pick `veo-3.1-*` ids. Draft uses lite; final uses generate.

- **Priority:** S · **Traces:** USR-17

---

### 2.6 Screening — FR-S *(manifest v3, retained)*

#### FR-S1
No new content type reaches a model without passing every configured screener.

- **Priority:** M · **Traces:** SYS-5

#### FR-S2
A screening layer may only add a block. No layer can overturn another’s block. A screener error blocks.

- **Priority:** M · **Traces:** SYS-5

#### FR-S3
Which screeners ran, and what each said, shall be visible in the trace (never the matched secret text).

- **Priority:** S · **Traces:** SYS-5

#### FR-S4 Second opinion
An additional model classifier (e.g. Gemma) may be added only under FR-S2. It is Should, not a Plus blocker.

- **Priority:** C · **Traces:** SYS-5

---

### 2.7 Meetings — FR-C *(manifest v3, retained)*

#### FR-C1
A meeting transcript is untrusted and screened before any model reads it.

- **Priority:** M · **Traces:** SYS-5

#### FR-C2
Commitments extracted from a call are proposals until confirmed. Nothing is sent, scheduled, or assigned on the transcript alone.

- **Priority:** M · **Traces:** USR-15, SYS-12

#### FR-C3
Live listening requires the user to be host, is opt-in per meeting (and honour a global off), and is visibly indicated for its whole duration.

- **Priority:** M · **Traces:** USR-14
- **Accept:** Switch hydrates from server so refresh does not look like withdrawn consent.

#### FR-C4
The product shall never claim the agent can speak in a meeting. UI copy and indicators are passive.

- **Priority:** M · **Traces:** USR-25 (Won’t)

#### FR-C5 Ladder
Attempt live listen when possible; else after-call transcript; else extension capture. Honest listen / read / none labels.

- **Priority:** M · **Traces:** USR-14

#### FR-C6 Insights metering
Insight passes follow the backing-off schedule and the plan table (0 / 0 / 300 / unmetered). “Check now” is counted.

- **Priority:** M · **Traces:** FR-B-2

#### FR-C7 Underage / encrypted / watermarked
If the Meet API refuses, the product shall fall back or say no — not join as a guest (Won’t).

- **Priority:** M · **Traces:** USR-25
- **Superseded in part (2026-08-31):** [ADR 0007](decisions/0007-guest-notetaker-until-meet-media.md). Media refusals (underage / E2E / watermark / hardware) still must not be bypassed. A **labelled, host-admitted, mute** notetaker is a separate opt-in rung (Tier 2.5) until Meet Media works; it is retired on Meet when `connectTier2` completes. Unannounced join remains a Won’t. Full ladder: [AllTheWay-Meeting-Joiner-Plan.md](AllTheWay-Meeting-Joiner-Plan.md).

---

### 2.8 Artifacts — FR-A

#### FR-A1 Noun
An artifact is a durable, versioned, exportable deliverable with owner, provenance (agent, card version, model, sources).

- **Priority:** M · **Traces:** USR-16

#### FR-A2 Versions
Versions are append-only. A correction note on a new version is the input to brand memory (FR-M4).

- **Priority:** M · **Traces:** USR-16

#### FR-A3 Export
The user can take their work out. Work that cannot leave is not owned.

- **Priority:** M · **Traces:** USR-16

#### FR-A4 Canvas
Desktop: conversation and artifact side by side. Mobile: sheet. A turn that produces work shall not leave Canvas empty when Yes kept an artifact (FR-CORE-6).

- **Priority:** M · **Traces:** USR-16

---

### 2.9 Co-work — FR-SH

#### FR-SH1 Share
Owner on Team or Max may share an artifact with a user who has signed in. Sharing with an unknown email is refused with an actionable message.

- **Priority:** M (Team) · **Traces:** USR-18, BUS-5

#### FR-SH2 Comments
Grantee may comment; owner sees comments on the artifact. Not live cursors.

- **Priority:** M (Team) · **Traces:** USR-18

#### FR-SH3 Access
Authoritative share lives under the artifact. `sharedWithMe` is an index, not the permission check.

- **Priority:** M · **Traces:** FR-D4e

#### FR-SH4 Revoke
Owner can revoke. A share that only ever adds is a defect.

- **Priority:** M · **Traces:** USR-18

---

### 2.10 Life / Today — FR-L

#### FR-L1 Today is the day
Today shall show the next twelve hours from Google Calendar (when connected) plus rhythms, leave-now, waiting-on-you, and capture. It shall not be a Studio lobby of promotional cards.

- **Priority:** M · **Traces:** USR-8

#### FR-L2 Leave-now
Reminders of kind leave shall fire for her. Missed pickup is worse than a missed digest. Target: within about one minute of due time.

- **Priority:** M · **Traces:** USR-8, NFR-PERF-3

#### FR-L3 Hats filter the timeline
`all` | `work` | `home` | `church`. Hats do not hide Work sessions. Quiet hours per hat are Today, not memory.

- **Priority:** M · **Traces:** USR-10

#### FR-L4 People, places, rhythms
She can add people (no login), places (buffer minutes), rhythms (weekdays, time, timezone, hat, person, place). Rhythms generate leave reminders without 180 todos.

- **Priority:** M · **Traces:** USR-8

#### FR-L5 Capture proposes
Photo/file → proposed commitments. Confirm (autonomy floor) is what writes Calendar.

- **Priority:** M · **Traces:** USR-9, FR-W7

#### FR-L6 No surprise writes
No silent calendar writes involving children or otherwise. Watchers propose.

- **Priority:** M · **Traces:** SYS-12

#### FR-L7 Push honesty
FCM on supported surfaces. iOS: only after Add to Home Screen; copy must say so; never fail silently.

- **Priority:** M · **Traces:** USR-8

#### FR-L8 Children’s names
Ordinary PII in her account. No child profile that looks like an account. Retention follows user deletion.

- **Priority:** M · **Traces:** USR-24 (Won’t)

#### FR-L9 Calendar missing
If Calendar is disconnected, Today shall say so (`connected` | `missing` | `error`), not show an empty day as if she had nothing on.

- **Priority:** M · **Traces:** USR-8

---

### 2.11 Memory — FR-MEM

#### FR-MEM-1 Four stores
Preference, working, brand, and life shall not be merged into one injection blob.

- **Priority:** M · **Traces:** SYS-8

#### FR-MEM-2 Human correction is the preference writer
`session.correction = { was, now, hat }`. Hat comes from **server** active hat, not the client body. Synthesizer keys (TEPA): continuation, same proposal, else new stem including hat. Revoke other standing rows with that key.

- **Priority:** M · **Traces:** USR-4
- **Accept:** Independent Navigation facts do not collide. A reversal of the same fact does. Evidence counts same key. Redelivery does not inflate (own-id excluded). Work and home of the same words do not revoke each other.

#### FR-MEM-3 Watchers do not write preferences
- **Priority:** M · **Traces:** FR-W6

#### FR-MEM-4 Injection filter
Turn injection includes standing rows with `revertedAt == null`, `proposed != true`, and hat unlabeled or equal to active hat. You lists proposed rows so they can be accepted.

- **Priority:** M · **Traces:** USR-4, USR-10

#### FR-MEM-5 Brand write path
Non-empty artifact correction note classifies aspect and writes `visualPreferences`, revoking the previous active row of that aspect.

- **Priority:** M · **Traces:** FR-M4

#### FR-MEM-6 Struggle writers
`users/{uid}/concepts/{id}` written only on **reask** or **miss**. Opening a citation does not write. Hit on a missing row writes nothing. Same document+label → one id. Visible and revertible on You.

- **Priority:** M · **Traces:** USR-20
- **Accept:** Third explanation instruction is in **system** context, not the user message.

#### FR-MEM-7 Sleep-time
After a session learns, generalise across ≥2 session keys in the same area and hat when `now` is shorter than `was`. New row `source: "synth"`, never `session-*`, never overwrite human. Confidence &lt; 0.6 stays `proposed`. Existing synth in that group is not duplicated.

- **Priority:** M · **Traces:** USR-4

#### FR-MEM-8 Accept / revert
Accept activates a proposed row (`proposed: false`). Revert stamps `revertedAt`. Accepting a non-proposed row is a no-op success.

- **Priority:** M · **Traces:** USR-5

#### FR-MEM-9 Transcripts
Voice transcripts are opt-in. They are not a synthesizer source. GenerateMemories is not invoked from transcripts.

- **Priority:** M · **Traces:** SYS-1

#### FR-MEM-10 Memory Bank extractor
If and only if `MEMORY_BANK_RESOURCE` is set, retrieve `USER_PREFERENCES` only, map to proposed unlabeled rows, drop personal-looking facts (child, school run, SSN-like). If unset, do not call it.

- **Priority:** S · **Traces:** BUS-10

#### FR-MEM-11 Active hat persistence
Today’s hat is stored on the person (`settings/hat`), not only in the browser.

- **Priority:** M · **Traces:** USR-10, FR-MEM-2

---

### 2.12 Billing and packaging — FR-B

#### FR-B-1 Plans
The four plans and allowances in §11 of the PRD / `PLANS` in `alltheway_metering` are requirements. Changing a limit without the price in the same change is a defect.

- **Priority:** M · **Traces:** BUS-1, BUS-3

#### FR-B-2 Meters
Meters: `voice_minutes`, `watcher_runs`, `connector_calls`, `documents`, `images`, `draft_video_seconds`, `final_video_seconds`, `meeting_insights`. Text turns are not metered.

- **Priority:** M · **Traces:** BUS-6

#### FR-B-3 Refuse before exceed
`check` before expensive effectors. Messages are actionable English (and translated).

- **Priority:** M · **Traces:** USR-19

#### FR-B-4 Effective tier
Paid only if Stripe status ∈ {active, trialing, past_due} **and** stored tier is a paid plan. Otherwise Free.

- **Priority:** M · **Traces:** BUS-2

#### FR-B-5 Checkout and portal
Plus/Team/Max via Stripe Checkout. Manage plan via Customer Portal. Lookup keys: `free`, `plus`, `team`, `max`.

- **Priority:** M · **Traces:** USR-19

#### FR-B-6 Sharing entitlement
Share APIs refuse Free and Plus.

- **Priority:** M · **Traces:** BUS-5

#### FR-B-7 Count after success
Voice minutes and watcher runs are counted after success, not on connect-that-failed.

- **Priority:** M · **Traces:** USR-19

---

### 2.13 Identity, registry, connectors — FR-I

#### FR-I-1 Auth
Every product API requires a verified Firebase ID token except documented public health/webhook routes. `ALLOW_ANONYMOUS` is refused when `NODE_ENV=production`.

- **Priority:** M · **Traces:** SYS-2

#### FR-I-2 Path isolation
See SYS-4. User-owned collections include at least: sessions, preferences, concepts, documents, documentChunks, artifacts, watchers, runs, ledger, visualPreferences, meetings, notes, commitments, people, places, rhythms, reminders, shares, settings, etc. as listed in `check-tenant-isolation.py`.

- **Priority:** M · **Traces:** SYS-4

#### FR-I-3 Signed cards
Every specialist publishes a signed AgentCard. The Agents page verifies signatures **when opened**, not only at deploy.

- **Priority:** M · **Traces:** SYS-3

#### FR-I-4 Connector gateway
The only path to Google APIs. Scope least privilege. `drive.file` not full Drive. Drafts/send scopes opt-in.

- **Priority:** M · **Traces:** SYS-7

#### FR-I-5 Webhooks
Stripe webhooks: signature verification, idempotency on `event.id`, refetch rather than trust body for entitlement.

- **Priority:** M · **Traces:** BUS-2

---

### 2.14 UX chrome — FR-UX

#### FR-UX-1 Five destinations
Today, Work, Studio, Watchers, You. No sixth Life app.

- **Priority:** M · **Traces:** USR-8

#### FR-UX-2 Honest chrome
No dead New, fake recents, fake trace, decorative search, or Team CTA to a missing `/contact` unless that route exists.

- **Priority:** M · **Traces:** BUS-4

#### FR-UX-3 Empty states
Truthful. “Nothing learned yet” is correct; seeded ids are not.

- **Priority:** M · **Traces:** BUS-4

#### FR-UX-4 Mobile contract
Capture and approve on mobile; compose and correct on desktop. Sign-out reachable on phone.

- **Priority:** M · **Traces:** SYS-11

#### FR-UX-5 Citations as UI
Citation chips, not only trace prose (visible half of FR-D2).

- **Priority:** M · **Traces:** USR-6, USR-20

#### FR-UX-6 i18n
New strings in every catalogue in the same change. `check-locales.py`. Auth screens have an i18n provider (no throw on `useT`).

- **Priority:** M · **Traces:** USR-21, NFR-I18N-1

---

## 3. Non-functional requirements (low-level)

### 3.1 Security — NFR-SEC

| ID | Requirement | Priority |
|---|---|---|
| **NFR-SEC-1** | Gateway only public ingress; backends internal. | M |
| **NFR-SEC-2** | Service-to-service: Google identity tokens; no shared god account. | M |
| **NFR-SEC-3** | Secrets in Secret Manager; no key files in repo. | M |
| **NFR-SEC-4** | Firestore rules: authenticated user only their subtree; default deny. Admin SDK is the app path. | M |
| **NFR-SEC-5** | Prompt injection: fail-closed screening (FR-S). | M |
| **NFR-SEC-6** | Org-admin floor waiver is auditable if ever granted (Team+). | S |

### 3.2 Privacy — NFR-PRIV

| ID | Requirement | Priority |
|---|---|---|
| **NFR-PRIV-1** | User deletion deletes their subtree (preferences, docs, life PII). | M |
| **NFR-PRIV-2** | No child accounts (FR-L8). | M |
| **NFR-PRIV-3** | Transcripts opt-in (FR-MEM-9). | M |
| **NFR-PRIV-4** | Export of artifacts the user owns (FR-A3). Profile export is Should. | S |

### 3.3 Isolation — NFR-ISO

| ID | Requirement | Priority |
|---|---|---|
| **NFR-ISO-1** | Zero acceptable cross-user retrieval rate. | M |
| **NFR-ISO-2** | `check-tenant-isolation.py` in CI. | M |
| **NFR-ISO-3** | Librarian owner assert on every chunk (FR-D4d). | M |

### 3.4 Performance — NFR-PERF

| ID | Requirement | Priority |
|---|---|---|
| **NFR-PERF-1** | Warm p95 first plan/clarify token: design target &lt; 5s (model-bound). Cold start shall not be reported as a product bug in copy. | S |
| **NFR-PERF-2** | Voice: conversational; 15-minute Live cap → honest resume. | M |
| **NFR-PERF-3** | Leave-now: fire within ~60s of `fireAt`. | M |
| **NFR-PERF-4** | Watcher minimum interval 60 minutes. | M |
| **NFR-PERF-5** | Meeting insights backing-off schedule (cost). | M |
| **NFR-PERF-6** | Research cell: max 4 workers, Flash only, wall-clock timeout. | M |

### 3.5 Reliability — NFR-REL

| ID | Requirement | Priority |
|---|---|---|
| **NFR-REL-1** | Retrieval failure is empty passages, not a failed turn. | M |
| **NFR-REL-2** | Image model down: FR-M5. | S |
| **NFR-REL-3** | Unreadable subscription → Free (never Max). | M |
| **NFR-REL-4** | Healthz on every service (including Cloud Run `/healthz/` quirk). | M |
| **NFR-REL-5** | Session persistence on Firestore, not process memory. | M |

### 3.6 Cost — NFR-COST

| ID | Requirement | Priority |
|---|---|---|
| **NFR-COST-1** | Scale to zero in non-demo. | M |
| **NFR-COST-2** | Meter expensive dimensions only (FR-B-2). | M |
| **NFR-COST-3** | Transcript processing unmetered. | M |
| **NFR-COST-4** | Never probe generative endpoints with valid payloads to “see if a model exists.” | M |

### 3.7 Internationalisation — NFR-I18N

| ID | Requirement | Priority |
|---|---|---|
| **NFR-I18N-1** | Seven catalogues complete vs English; placeholders preserved; plural categories complete. | M |
| **NFR-I18N-2** | Voice does not pin language (FR-V6). | M |
| **NFR-I18N-3** | Machine-translated catalogues shall be marked unreviewed until native review. | S |

### 3.8 Accessibility — NFR-A11Y

| ID | Requirement | Priority |
|---|---|---|
| **NFR-A11Y-1** | WCAG AA on primary flows (Today, confirm, You, documents). | M |
| **NFR-A11Y-2** | `prefers-reduced-motion` respected. | M |
| **NFR-A11Y-3** | Keyboard: confirm, citation sheet, hat filters, sign-out. | M |
| **NFR-A11Y-4** | Do not encode watcher running vs paused by colour alone. | M |

### 3.9 Observability — NFR-OBS

| ID | Requirement | Priority |
|---|---|---|
| **NFR-OBS-1** | OpenTelemetry / Cloud Trace on turn path (orchestrator must log more than start/stop). | S |
| **NFR-OBS-2** | Transparent Trace shows what the user is owed: retrieved passages, screeners, connector calls — not a hardcoded Home poem. | M |
| **NFR-OBS-3** | Usage and digest built from live data, not a lying snapshot. | M |

### 3.10 Operability — NFR-OPS

| ID | Requirement | Priority |
|---|---|---|
| **NFR-OPS-1** | Infra as Terraform; prod/dev workspaces. | M |
| **NFR-OPS-2** | Cloud Build on `main`; image deps match Dockerfiles (`check-image-deps.py`). | M |
| **NFR-OPS-3** | Every new `*.test.ts` listed in the package test script (`check-tests-listed.py`). | M |
| **NFR-OPS-4** | Firestore indexes and TTL as code. | M |

---

## 4. Won’t / refused (so they are not filed as gaps)

| ID | Statement |
|---|---|
| **W-1** | Guest meeting bot (headless browser join). |
| **W-2** | Agent speaking in Meet (FR-C4). |
| **W-3** | Native mobile/desktop apps. |
| **W-4** | Live multiplayer CRDT editing. |
| **W-5** | Video as a chat modality or watcher action. |
| **W-6** | Cross-user retrieval. |
| **W-7** | Kids’ logins / child Cognitive Profiles. |
| **W-8** | Motion-style silent calendar reshuffle. |
| **W-9** | Mem0 / Zep / Letta as the profile. |
| **W-10** | Church CMS; church is a hat. |
| **W-11** | Silent transcript training / GenerateMemories from school-run chat. |
| **W-12** | Filename-inferred document hats. |
| **W-13** | Marketing tutor claim without a quiz product. |

---

## 5. Data requirements (logical)

| Entity | Path / store | Notes |
|---|---|---|
| Session + thread + correction | `users/{uid}/sessions/{id}` | Correction hat from server |
| Ledger | `users/{uid}/ledger` | Append-only; voice and text |
| Preferences | `users/{uid}/preferences` | Key, hat, source, proposed, revertedAt |
| Concepts | `users/{uid}/concepts` | Struggle; reask/miss |
| Visual preferences | `users/{uid}/visualPreferences` | Brand |
| Documents / chunks | `users/{uid}/documents`, `documentChunks` | Working memory |
| Artifacts / versions / shares | under user / artifact | Share does not widen chunks |
| Watchers / runs | `users/{uid}/watchers`, `runs` | |
| Life | `people`, `places`, `rhythms`, `reminders`, `proposedCommitments` | |
| Hat / locale / onboarding / voice keep | `users/{uid}/settings/*` | |
| Subscription | `subscriptions/{uid}` | status + tier |

---

## 6. Interface requirements

| ID | Requirement |
|---|---|
| **INT-1** | Web: marketing `/`, product `/app`, PWA installable. |
| **INT-2** | Extension: MV3; capture when hosted meeting is not an option; no scraping of auth from the page. |
| **INT-3** | Wire types: `@alltheway/contracts` shared by web and gateway. A renamed field must fail the other side. |
| **INT-4** | A2A between internal agents; AgentCards at well-known URLs; `A2A-Version` as required by the stack. |
| **INT-5** | SSE for text turns; WebSocket for voice. SSE not behind Firebase Hosting (ADR 0001). |

---

## 7. Acceptance of the specification (product-level)

The specification is satisfied for Plus GA when all **M** requirements in this document are true on a **new** account, and the PRD fitness function holds:

1. Not quite → one standing preference on You → next plan uses it → reverse retires the old row without deleting it.
2. Too much blue → constrained regenerate → revertible palette.
3. Cited document turn; delete stops retrieval.
4. Today answers leave-now from Calendar + rhythms.
5. Yes creates the calendar event (or refuses with a real connector error, not “nothing ran” theatre).
6. Guards are green: tenant isolation, locales, tests listed, plan table, image deps.

Team GA additionally requires FR-SH-* and BUS-5. Max GA additionally requires FR-M2 and the video meters.

---

## 8. Traceability matrix (compact)

| User job | Primary FRs |
|---|---|
| Talk / type a task | FR-CORE-1, FR-V1, FR-V8, FR-UX-1 |
| Ambiguity | FR-CORE-2 |
| Confirm / Not quite | FR-CORE-4, FR-CORE-6, FR-MEM-2 |
| Inspect memory | FR-MEM-4, FR-MEM-8, FR-UX-3 |
| Document Q&A | FR-D1–D8, FR-UX-5 |
| Leave-now | FR-L1–L9 |
| Watchers | FR-W1–W7 |
| Meetings | FR-C1–C7 |
| Images / video | FR-M1–M6, FR-A* |
| Share | FR-SH1–4, FR-B-6 |
| Pay | FR-B-1–7 |
| Isolation | FR-D4, FR-I-2, NFR-ISO-* |

---

## 9. Document history

| Date | Change |
|---|---|
| 2026-08-29 | First complete high-level + low-level requirements spec for PM, preserving existing FR-V/W/D/M/S/C ids and adding CORE, A, SH, L, MEM, B, I, UX, NFR families |
| 2026-08-29 | FR-V8 spoken hang-up: `end_this_conversation` closes the live socket after farewell; leaving is not yes |

**Related:** [AllTheWay-PRD.md](AllTheWay-PRD.md) is the product requirements document this specification implements.
