# AllTheWay — Product Manifest v3
### From a companion you talk to, into a space you work in

*Supersedes Product Manifest v2. v2 unified three tracks into one companion: it talks with you, watches and acts for you, and remembers you. That companion is now built and deployed. v3 answers the question that follows — **what does it feel like to actually work with it, all day, for everything** — and finds that the answer needs capabilities v2 never scoped.*

**Date:** 2026-08-26 · **Status of v2 scope:** delivered (Phases 0–8) · **This document:** proposed

*Companion: [v3 Implementation Plan](AllTheWay-v3-Implementation-Plan.md) — phases, data models, infrastructure, interface design and proof obligations. Note that the plan **inverts §6's tier default** on direction: Tier 2 (live) is attempted first on every meeting, with an automatic fallback ladder to Tier 1.*

---

## 0. The honest starting point

v2's three pillars work. What is deployed today can hold a stateful conversation, plan a turn with a visible Clarify Gate, confirm before anything irreversible, run unattended watchers under an autonomy ceiling, reach four Google connectors through one policy-enforcing gateway, screen untrusted content with Model Armor, and publish a signed AgentCard for every agent in the system.

And yet, measured against the Collaborative Partner brief as written —

> *Stateful, multi-turn dialogue with **real-time context retrieval (RAG)** and persistent memory, so your agent adapts and personalizes based on past interactions.*
> *Examples: an expert guide that helps you understand a **dense legal document**, **quizzes you** as you go, learns which concepts you struggle with. A **UI/UX helper** that turns a vague idea into a **wireframe** and learns your brand preferences from your corrections.*

— three things are simply absent from the product, and it is worth naming them plainly before proposing anything:

| The brief says | What exists today |
|---|---|
| real-time context retrieval (RAG) | **Nothing retrieves.** Memory is a flat list of learned preference *strings* injected into the prompt. That is personalization; it is not retrieval. |
| a dense legal document | **No file can enter the product.** There is no upload, no parse, no store. Text and voice are the only inputs. |
| turns a vague idea into a wireframe | **Nothing is produced but plans and traces.** The agent has no way to hand you an artifact you can look at, correct, and keep. |

Neither of the brief's own two examples can be built on what we have. That is the gap v3 closes.

There is a second gap, from the other direction. The product is a **single-player** application. Every collaborative affordance a person expects from a workspace in 2026 — sharing a piece of work, commenting on it, seeing what changed, being in a meeting together — is missing, because v2's model of collaboration was *human ↔ agent* and never *human ↔ agent ↔ human*.

---

## 1. What the research changed

Five findings materially altered the design. Each is recorded with what it ruled *out*, because a manifest that only lists what became possible is a wish list.

### 1.1 Video is a deliverable, not a turn — and it is Veo, not Omni Flash

The name "Gemini Omni Flash" implies a real-time any-modality model that would supersede our Live API relay. **It is not.** `gemini-omni-flash-preview` takes text, images and video *in* and emits **video with synchronised audio** *out*, at **$0.10 per second**, capped at 10-second generations, in public preview.

**We use Veo instead**, and the reason is not only the hackathon bonus. Omni Flash is a single preview model at one price point. Veo is a *family*, all three members GA and reachable, which is what makes a tier structure possible at all:

```
veo-3.1-generate-001           EXISTS   ~$0.75/s   final render
veo-3.1-fast-generate-001      EXISTS   ~$0.10/s   same price as Omni Flash
veo-3.1-lite-generate-001      EXISTS   ~$0.05/s   drafting
veo-3.1-lite-generate-preview  absent
veo-2.0-generate-001           absent
gemini-omni-flash-preview      exists, preview only, one price
```

Fast matches Omni Flash exactly on price, so switching costs nothing and buys a **draft-cheap, render-expensive** ladder — the same shape that makes Nano Banana 2 Lite work for images. You iterate at $0.05/s and pay $0.75/s once, for the one you keep.

**What this rules out either way:** any "video call with your agent" framing. At $0.75/s a single 8-second clip is **$6.00** — four orders of magnitude above a text turn. Video cannot sit on a conversational path.

**What it rules in:** a deliberate, rare, user-initiated artifact, priced and presented as a deliverable.

> **A note on how this was verified.** The first probe of these endpoints used a *valid* payload against `:predictLongRunning`, which does not report on a model — it **starts a generation**. Two ran before anyone intended them to, at roughly $6 each. Every later probe used a deliberately invalid payload, so a live model answers `400` (it exists, and refused) rather than `200` (it exists, and is now billing you). **Probing a generative endpoint is not a read.** This is now the house rule for checking model availability.

### 1.2 Nano Banana 2 Lite is the enabler for the brief's own second example

`gemini-3.1-flash-lite-image` — GA, ~4 seconds per 1K image, **$0.034 per 1,000 images**, with C2PA content credentials and SynthID watermarking on by default. That price is *not* in artifact territory; it is cheap enough to be conversational. Generating a wireframe, correcting it, and regenerating ten times costs a third of a penny.

Verified, and it corrected an official source: Google's Cloud blog spells the id `gemini-3-1-flash-lite-image`; that returns **404**. The dotted `gemini-3.1-flash-lite-image` returns **200**. Both new models are **`global`-only** — `europe-west1` 404s on each, which matters for §8's residency note.

**This is the single highest-leverage addition in v3.** The brief's UI/UX-helper example goes from impossible to nearly free.

### 1.3 An agent cannot speak in a Google Meet — but it can listen, and it can read afterwards

Two distinct Google APIs, and conflating them would produce a promise we cannot keep.

**Meet Media API** — the sanctioned way for a non-human client to join a live conference. Hard constraints, all disqualifying for general use today:
- **Developer Preview**, and the Cloud project, OAuth principal **and every participant** must be enrolled in it
- **Receive-only.** It consumes audio, video and participant metadata. It does not transmit. *Our agent cannot talk in the meeting.*
- Refused when underage accounts are present, when the meeting is encrypted, or when it carries a watermark
- Requires a consenting host present, and every participant sees an initiation dialog

**Meet REST API + Google Workspace Events API** — **GA**. Subscribe to meeting events; after a conference ends, retrieve conference records, participants, recordings and **transcripts**. No joining, no preview enrolment, no dialog.

**The design that follows (live listen):** AllTheWay does not pretend it can talk in your meeting. It listens when a sanctioned path exists, or it reads the transcript when the call ends.

**Superseded in part (2026-08-31):** the sentence “does not pretend to attend” and “without a bot silently sitting in your client's meeting” still forbid a *silent* extra participant. A labelled, mute, host-admitted notetaker is a temporary capture rung until Meet Media enrolment — [ADR 0007](decisions/0007-guest-notetaker-until-meet-media.md). Default capture remains tab capture / after-call (nothing extra in the list).

Live listening (Media API) is scoped as an **opt-in preview** for meetings the user themselves hosts.

### 1.4 OpenWorker validates our safety model and exposes one real gap

The reference is strikingly convergent with AllTheWay: approval gates before consequential actions, cloud access held read-only, evidence attached to every finding ("the command that verified it"), and explicit human veto. That is our Confirm Gate, our autonomy floor, and our Transparent Trace, arrived at independently. Good confirmation that the safety posture is not over-engineered.

The divergence is the lesson. OpenWorker is **artifact-first**: work lands as a PR, a report, a diff, a Markdown file — a *thing* — rather than as prose. AllTheWay is plan-and-trace-first, and a plan is not a deliverable. Its other move — **named specialist coworkers** rather than one general agent — is how it makes capability legible.

It is also **desktop-first**, which informs §7 but does not decide it: OpenWorker is desktop-native because it stores credentials locally and runs local models. Neither constraint is ours.

### 1.5 The interface patterns for agents have converged, and we are missing half of them

The five patterns now considered table stakes for an agent interface: **planning visibility, tool-use disclosure, memory surfacing, multi-step workflow tracking, recovery routing.**

We have planning visibility (Plan Panel), tool-use disclosure (Transparent Trace) and partial memory surfacing (Cognitive Profile). We lack workflow tracking across long-running work and any deliberate recovery routing.

The stronger finding: **chat does not scale past a few steps.** The scroll-to-find-context pattern breaks down, and the category has answered with the canvas — an artifact the conversation acts *on*, rather than a transcript the work is buried *in*. Claude's artifacts, ChatGPT's canvas, Figma and Miro all resolve to the same shape: conversation and workspace side by side, integrated rather than siloed.

Our Plan Panel is the seed of this and is currently the only thing in the third column.

---

## 2. The journey, as a real day

v2 described capabilities. v3 describes a day, because the gaps only become obvious in sequence. Each moment is annotated with what exists (✔), what is missing (✗), and where it is addressed.

**07:40 — the commute.** Phone. She asks out loud what today looks like. The agent answers in her language, switches to Yoruba mid-sentence when she does, and reads back the two things it thinks need a decision.
✔ voice, ✔ multilingual (97 languages, auto-switching), ✔ ceiling-gated actions · ✗ *nothing is glanceable — a spoken answer leaves nothing behind and is gone the moment it ends* → §5.3 **Digest**

**09:15 — the contract.** A 40-page supplier agreement lands. She asks what changed from last quarter's version and what she should push back on.
✗ **the file cannot enter the product** → §4 **Documents & Retrieval**

**10:00 — the call.** A 45-minute Meet with the supplier.
✗ no presence, no notes, no follow-through → §6 **Meetings**

**11:30 — the idea.** "The onboarding screen feels cluttered — show me a simpler version."
✗ nothing can be drawn → §5 **Multimodal**

**14:00 — the correction.** The wireframe is close but the brand is wrong: too much blue, wrong corner radius. She says so.
✔ the Feedback Ledger records the correction · ✗ *it cannot be applied to a regeneration, because there is no artifact and no visual memory* → §5.2 **Brand memory**

**16:20 — the handoff.** She wants a colleague to look at the plan before it goes out.
✗ **nothing can be shared** → §7 **Co-work**

**22:00 — the quiz.** She has ten minutes and wants to actually understand the indemnity clause.
✗ no teaching loop, no struggle model → §4.3 **Guided understanding**

Seven moments; **five are impossible today**. That is the shape of v3.

---

## 3. Pillar 1, deepened: the Collaborative Partner the brief actually describes

v2 retained Pillar 1 "unchanged in substance". v3 changes it, because the brief's two examples are both out of reach.

### 3.1 Memory becomes two things, not one

Today "memory" is one thing: the Cognitive Profile, a list of learned preferences. The brief needs two, and conflating them is why RAG is missing.

| | **Preference memory** (have) | **Working memory** (missing) |
|---|---|---|
| holds | how you like things done | what you are working on |
| example | "trims navigation rather than adding to it" | this contract, that transcript, last week's wireframe |
| shape | short strings, injected into every prompt | chunked, embedded, retrieved on relevance |
| grows | slowly, by correction | quickly, by use |

Injecting working memory the way preferences are injected does not scale past a handful of documents — which is exactly why retrieval exists. **This is the RAG the brief names**, and it is a genuine addition, not a rebrand of what we have.

### 3.2 A struggle model, because "learns which concepts you struggle with" is a data structure

The brief asks for an agent that notices what you find hard and adapts. That is not a prompt instruction; it is state. Per concept, per user: times encountered, times re-asked, times explained again, last confidence. It belongs in the Cognitive Profile beside preferences, is visible and revertible like everything else there, and is the input that makes the third explanation different from the first.

### 3.3 Corrections must reach the thing being corrected

The Feedback Ledger already records that a user corrected something. Today that correction changes future *plans*. It cannot change the *artifact*, because there are no artifacts. Once there are (§5), a correction becomes: regenerate this, with this constraint, remembered next time. That closes the loop the brief describes — "learns your brand preferences from your corrections" — and it is the difference between a ledger that records history and one that does work.

---

## 4. New pillar: Documents & Retrieval

**What it does.** A user brings the thing they are actually working on — a contract, a spec, a deck, a transcript, a photo of a whiteboard — and the agent works *on it*, not merely near it.

### 4.1 The parts

- **Ingest.** Upload from desktop; camera and share-sheet from mobile. PDF, DOCX, TXT, MD, images. Fetched from a connected Drive with `drive.file` scope, which already limits reach to what this app created or the user explicitly opened.
- **Understand.** Extract, chunk, embed. Store per user, scoped by session where the user wants it scoped.
- **Retrieve.** Relevant passages retrieved per turn and cited — with the citation visible in the Plan Panel, not a claim in prose.
- **Screen.** Every ingested document is untrusted external content and goes through the same fail-closed Model Armor path as watcher-ingested email. **A PDF is a prompt-injection vector**; treating an upload as trusted because the user chose it would undo the control we already built.

### 4.2 Grounded, or silent

An answer about a document must cite the passage it came from, or say it could not find one. The failure mode this exists to prevent is the one that destroys trust in exactly the use case the brief names: a confident, fluent, wrong summary of an indemnity clause.

### 4.3 Guided understanding — the teaching loop

The brief's first example is not a summariser; it is a tutor. Explain a clause → check understanding with a question → record whether it landed → adapt the next explanation. The struggle model (§3.2) is what makes the loop close. This is also the most defensible non-work use of the product — the "everyday, leisure" half of *AllTheWay*: a dense insurance policy, a mortgage offer, a textbook chapter.

**Functional requirements**
- **FR-D1** No document is used without being screened; a blocked document halts and says so, and never reaches a model.
- **FR-D2** Every document-grounded claim carries a citation to a retrievable passage, or the agent states it could not ground the answer.
- **FR-D3** A document is deletable, and deletion removes its embeddings — visibly, with a confirmation of what was removed.
- **FR-D4** Retrieval is scoped to exactly one user. Cross-user retrieval is not a missing feature; it is a breach, and it is the one property in this product with no acceptable failure rate.
  - **FR-D4a** Chunks are stored under a path containing the owner's uid — never a flat collection with an owner field.
  - **FR-D4b** No `collectionGroup` query touches a document or chunk collection. It is the only construct that spans users.
  - **FR-D4c** The retrieval service derives the user from a verified scope token. It has no `uid` parameter that could be passed a wrong value.
  - **FR-D4d** Every retrieved chunk's owner is asserted against the requester before it enters a prompt. A mismatch fails the turn.
  - **FR-D4e** A share grants an artifact, never a corpus. Retrieval scope stays one user regardless of sharing.
- **FR-D5** What was retrieved for a turn is inspectable in the Transparent Trace.

---

## 5. New pillar: Multimodal — see it, show it, sketch it

### 5.1 Seeing

Images as first-class input: a whiteboard photo, a screenshot of a bug, a page of a contract, a receipt. On mobile this is the camera, and it is the single most natural capture surface the product does not currently have.

### 5.2 Showing — wireframes, and the brand memory that makes them yours

`gemini-3.1-flash-lite-image` at ~4s and $0.034/1K makes generate-correct-regenerate a *conversation*, not a purchase. The loop the brief describes:

> vague idea → wireframe → "too much blue, softer corners" → better wireframe → **and it remembers, next time**

The remembering is the product. Any model can draw a wireframe; the differentiator is that the tenth one starts where the ninth correction left off. Brand preferences (palette, density, corner radius, tone) live in the Cognitive Profile as a **visual preference set** — visible, editable and revertible like every other learned preference, because a brand memory you cannot correct is worse than none.

**Provenance is not optional.** C2PA credentials and SynthID watermarks are on by default and stay on. Every generated image is labelled as generated, in the UI, always. A product whose whole thesis is a visible audit trail cannot ship unlabelled synthetic media.

### 5.3 Moving pictures — deliberately rationed, and tiered by intent

Video is the only capability in this product where a single careless action costs more than a month of someone's plan. It is therefore the only one with a hard structural answer rather than a limit.

**Draft cheap, render once.**

| | model | cost | used for |
|---|---|---|---|
| draft | `veo-3.1-lite-generate-001` | ~$0.05/s | the first six attempts |
| standard | `veo-3.1-fast-generate-001` | ~$0.10/s | the one you are fairly sure about |
| final | `veo-3.1-generate-001` | ~$0.75/s | the one you will actually send |

The user never picks a model. They ask for a draft or a final, and the ladder is an implementation detail of that choice — the same way Nano Banana 2 Lite is an implementation detail of "show me a wireframe".

Every generation is explicit, cost-disclosed before it runs ("this is about 15 seconds of your Max allowance"), and **never available to an unattended watcher at any autonomy ceiling**. A watcher that could spend £5 on its own initiative is not a watcher operating under a ceiling; it is an unbounded liability with a nice name.

**Functional requirements**
- **FR-M1** Every generated image and video is labelled as AI-generated in the UI, with C2PA/SynthID preserved in the file.
- **FR-M2** Video generation always requires explicit confirmation with its cost stated, at every autonomy ceiling, and is never available to an unattended watcher. A *final* render additionally requires a second confirmation, because it costs roughly fifteen times a draft.
- **FR-M3** An uploaded image is untrusted content and is screened before a model reads it.
- **FR-M4** Visual preferences are visible in the Cognitive Profile and revertible individually.
- **FR-M5** Image generation degrades to a described layout rather than failing the turn when the model is unavailable.

---

## 5A. Gemma: closing the gap our own screening code admits to

`libs/screening` says this about itself, and has since Phase 6:

> `HeuristicScreener` is a real layer and it catches the common attacks, but it is **pattern matching**: it will miss a paraphrase, another language, or an encoding it has not seen.

That admission is now a live problem rather than a theoretical one. v3 lets a user upload a contract (§4) and reads meeting transcripts (§6) — both untrusted content from strangers, and both far more likely to carry a paraphrased injection than a watcher's email trigger ever was. Model Armor is the production screener and it is good, but a single screener is a single point of failure for the one control that must not fail.

**Gemma becomes the second opinion.** A small open model classifying "does this text attempt to instruct the reader?" catches paraphrase and translation that a regex cannot, and does it at a fraction of a frontier model's cost. Verified reachable on Vertex — `gemma-3-27b-it`, `gemma-3-12b-it`, `gemma-3-4b-it` and `gemma-2-9b-it` all respond.

It slots into the existing `Screener` protocol with no structural change, which is the point: the seam was built in Phase 6 for exactly this. The composition rule is unchanged and non-negotiable — **any screener returning blocked blocks**, and any screener that errors blocks. Adding a layer can only ever make the system more cautious, never less.

`gemma-3-4b-it` is the working choice: large enough to read intent, small enough that screening every uploaded page is not a cost decision someone has to think about.

**FR-S1** No new content type reaches a model without passing every configured screener.
**FR-S2** A screening layer may only ever add a block. No layer can overturn another layer's block.
**FR-S3** Which screeners ran, and what each said, is visible in the Transparent Trace.

---

## 6. New pillar: Meetings

### 6.1 Two tiers, honestly labelled

> **Superseded by direction (2026-08-26): Tier 2 is the default.** The implementation plan attempts the live Media API on every meeting and falls back down this ladder when it is refused — which it often will be, for reasons outside our control. The tiers below are unchanged in substance; only which one is tried first has moved. See [the plan, §7.2](AllTheWay-v3-Implementation-Plan.md).

**Tier 1 — After the call (GA).** Subscribe via Workspace Events. When a conference ends, retrieve the transcript and participants, run it through screening, and produce a plan: decisions made, commitments given, who owes what. Nothing sends until confirmed. This requires no bot in the room and no preview enrolment.

**Tier 2 — In the call (Developer Preview, now attempted first, own meetings only).** Meet Media API. Live notes as the call proceeds. **The agent listens; it cannot speak** — the API is receive-only, and the manifest says so rather than letting a user infer otherwise from the phrase "join calls".

### 6.2 What we will not do

We will not run a headless browser that joins as a guest participant to work around the API's limits. It is the industry's common pattern and it is available. It is also an unannounced participant in someone else's meeting, which contradicts the entire trust posture of this product. If Google's sanctioned path is not available for a given meeting, the honest answer is Tier 1.

**Functional requirements**
- **FR-C1** A meeting transcript is untrusted content and is screened before any model reads it.
- **FR-C2** Commitments extracted from a call are proposals until confirmed; nothing is sent, scheduled or assigned on the strength of a transcript alone.
- **FR-C3** Live listening requires the user to be the meeting's host, is opt-in per meeting, and is visibly indicated for its whole duration.
- **FR-C4** The product never claims the agent can speak in a meeting.

---

## 7. Co-work: what we have, what is missing, what we will build

The direct answer to *"what co-work features do we support today?"*

### 7.1 Today

| Have | Where |
|---|---|
| Stateful multi-turn sessions | Sessions, Session Detail |
| Visible plan, built collaboratively | Plan Panel |
| Clarify-before-commit | Clarify Gate |
| Confirm-before-irreversible | Confirm Gate, autonomy floor |
| Decision history | Feedback Ledger |
| Learned preferences, revertible | Cognitive Profile |
| Unattended follow-through | Watchers, ceilings, waivers |
| Tool access under one policy point | Connector Gateway, 4 Google connectors |
| Provenance and attribution | Transparent Trace, Agent Registry, signed cards |
| Spoken collaboration | Voice relay, 97 languages |
| Cost visibility | Usage |

That is a strong **human ↔ agent** collaboration surface. It is, by design so far, a **single-player** one.

### 7.2 Missing

Ordered by how badly the day in §2 breaks without them.

| Missing | Why it matters | Where |
|---|---|---|
| **Artifacts** — a thing produced, kept, corrected | Plans are not deliverables. OpenWorker's central lesson | §7.3 |
| **Files and images in** | Blocks both of the brief's examples | §4, §5 |
| **Retrieval** | The brief names it; nothing retrieves | §4 |
| **Sharing** — send work to a person | The product ends at one user | §7.4 |
| **Comments** — react to a specific thing | Feedback is per-turn, not per-artifact | §7.4 |
| **Version history** — what changed, undo | We have a ledger of decisions, not of documents | §7.3 |
| **Digest / notifications** | Watchers run and nobody is told | §5.3 of v2, unbuilt |
| **Meeting presence** | §6 | §6 |
| **Named specialists** | One general agent hides its own capability | §7.5 |
| **Export** | Work that cannot leave is work you do not own | §7.3 |
| **Recovery routing** | A failed step has no path back | §9 |

### 7.3 Artifacts — the missing noun

An **Artifact** is a durable, versioned, correctable thing the agent produced: a document, a wireframe, a summary, a checklist, a generated image. It has an owner, a version history, a provenance record (which agent, which card version, which model, which sources), and it can be exported.

This is the single largest structural addition in v3, and it reframes the third column: the Companion panel becomes the **Canvas** — conversation on one side, the thing being worked on beside it, exactly the convergence the category has reached.

### 7.4 Sharing — the smallest honest step into multiplayer

Deliberately *not* live multiplayer editing. Presence, cursors and CRDTs are a large build with a large failure surface, and they are not what §2's 16:20 moment needs. What it needs is: send this artifact to a colleague, let them comment, see their comments in the same trace as everything else.

**Share → comment → resolve.** Async, permissioned, audited. Live co-editing is explicitly deferred and named as such rather than left as a vague future.

### 7.5 Specialists

The registry already lists agents with owners, skills and signature status. Users should see the same thing in product terms: a **Document guide**, a **Design partner**, a **Meeting scribe**, a **Researcher**. Same orchestrator, same floor, same trace — but capability becomes legible, and the registry we built for governance earns a second job as a product surface.

---

## 8. Surfaces: mobile web and desktop web. Not a desktop app.

The direct answer to *"desktop only, or mobile view and desktop web?"*

**Both, responsively, on the web. No native or desktop app.**

The reasoning, and where it differs from OpenWorker:

- **Voice and camera are mobile moments.** §2's 07:40 and 09:15 happen on a phone. A desktop-only product cannot have the commute, and the commute is where a companion earns its place.
- **Documents and canvas are desktop moments.** A 40-page contract and a wireframe critique are not phone work. Desktop is where the artifact lives.
- **OpenWorker went desktop-native for reasons we do not share.** It stores credentials on-device and runs local models. Our credentials are in Secret Manager, our models are on Vertex, and our services are on Cloud Run. The constraint that made desktop-native right for them does not apply.
- **We already have the shell.** The app is an installable PWA with a service worker, a responsive layout, and — as of this week — a mobile companion sheet. The gap is not the platform; it is what fills it.

**The rule this sets:** every capability in v3 must have a defined mobile behaviour, even if that behaviour is "read and approve, but compose on desktop". A feature with no mobile answer is not finished. Concretely — capture and approve on mobile; compose and correct on desktop.

---

## 9. What this does to the UI

v2's shell is: sidebar / work / companion, with a mobile tab bar. v3 needs five changes.

**9.1 The third column becomes the Canvas.** Today it holds a conversation. It becomes the artifact under discussion, with the conversation acting on it. On mobile it is the sheet that already exists, promoted from chat to artifact view.

**9.2 A composer that accepts things.** The input becomes a drop target with attach and camera affordances. This is the entry point for §4 and §5 and currently does not exist in any form.

**9.3 Citations and provenance are UI, not prose.** A grounded claim shows its source inline and opens the passage. A generated image is visibly labelled. Both are the visible half of FR-D2 and FR-M1 — the trust story is only real if it is on screen.

**9.4 Recovery routing.** Every failure state gets a route forward: retry, edit the request, do it manually, or ask for help. Today a failed turn shows a message and stops, which is the pattern the research names as the most commonly missing.

**9.5 A digest surface.** Watchers run unattended and nothing tells anyone. A daily digest — what ran, what is waiting, what needs a decision — with a mobile notification. Autonomy without a report is just software doing things you did not see.

**Accessibility and motion** stay as they are: reduced-motion respected, contrast checked, keyboard reachable. New surfaces inherit the same bar, and the existing browser-run checks extend to cover them.

---

## 10. Monetization delta

The dimensions with real marginal cost gain three members. Each is here because it is *expensive*, not because it is countable.

| | Free | Plus £18 | Team £32/seat | **Max £60** |
|---|---|---|---|---|
| voice minutes | 30 | 600 | unmetered | unmetered |
| watcher runs | 50 | 1000 | unmetered | unmetered |
| connector calls | 200 | 5000 | unmetered | unmetered |
| documents stored | 5 | 200 | unmetered | unmetered |
| images generated | 20 | 500 | 2000/seat | unmetered |
| **draft video seconds** | 0 | 20 | 60/seat | **300** |
| **final render seconds** | 0 | 0 | 10/seat | **20** |

### Why Max exists, and why it is priced where it is

Every other tier is bounded by things that cost fractions of a penny. Max exists because **one capability breaks that model**: a final Veo render is ~$0.75 per second, so a single 8-second video costs about **$6.00** — a third of an entire Plus subscription, spent in one click.

That cannot be absorbed into Plus, and metering it inside Plus would produce a limit so small it would read as broken. A separate tier is the honest structure.

**The unit economics, stated so they can be argued with:**

```
Max revenue                £60/mo   ≈ $76
  300s draft   @ $0.05/s   = $15.00
   20s final   @ $0.75/s   = $15.00
  video cost               = $30.00   (~39% of revenue)
```

That leaves roughly 60% before voice, models and infrastructure — thin for a software product, and deliberately so: video is a cost centre being sold at a modest margin, not a profit centre. If the PM wants a healthier margin, the lever is the **final render** allowance, not the draft one.

**Two things I need you to decide, rather than have me decide quietly:**

1. **Currency.** You said **$60**; every existing tier in `libs/metering` is in pence (£18, £32). I have written **£60** to keep one currency, because a table mixing £ and $ is a bug waiting to be shipped. If it should be $60, all four tiers need converting — that is a code change, not a doc change.
2. **Final renders on Team.** 10 seconds/seat is $7.50 of cost inside £32 — the tightest ratio in the table. It may be better at zero, pushing anyone who needs a finished video to Max.

Meeting transcript processing stays **unmetered**: it is cheap, and metering it would discourage exactly the behaviour that makes the product valuable. Sharing remains **Team and above** — that is where willingness to pay actually is.

---

## 11. Risks, and what we are not building

**Risks**
- **A confident wrong answer about a document** is the worst failure this product can have, and §4's use cases are precisely where it would happen. FR-D2 (grounded or silent) is the control, and it must not be softened for fluency.
- **Prompt injection via uploads.** A PDF or a meeting transcript is untrusted content from a stranger. The existing fail-closed screening path covers it only if we route uploads through it, which FR-D1 and FR-C1 require.
- **Synthetic media without provenance.** Mitigated by FR-M1 and by never stripping C2PA/SynthID.
- **Video cost runaway.** Mitigated by FR-M2 — confirmation at every ceiling, never available to a watcher.
- **`global`-only models.** Both new models are unavailable in `europe-west1`. Text generation already runs on `global`; images and video extend that. This makes open decision 6 (EU residency) materially harder and should be recorded as a cost of these features, not discovered later.
- **Meet Media API's preview constraints** may not relax. Tier 1 is designed to be sufficient alone, so the product is not waiting on a programme we do not control.

**Not building**
- A meeting bot that joins as a guest participant (§6.2)
- Live multiplayer co-editing, cursors, CRDTs (§7.4) — deferred, not denied
- A native mobile app or a desktop app (§8)
- Video as a conversational modality (§5.3)
- Cross-user retrieval (FR-D4)

---

## 11A. Google model integration, and what each is actually for

Three Google models beyond Gemini, each verified reachable on this project. Each is here because it does a job the product needs — a model integrated for its own sake is a feature that reads as bonus-chasing, and users can tell.

| model | verified | job |
|---|---|---|
| **Veo 3.1** (`veo-3.1-generate-001`, `-fast-`, `-lite-`) | all three exist | the video artifact ladder — draft at $0.05/s, render once at $0.75/s (§5.3) |
| **Gemma 3** (`gemma-3-4b-it` and larger) | exists | the second screening opinion, closing a gap `libs/screening` already documents (§5A) |
| **Nano Banana 2 Lite** (`gemini-3.1-flash-lite-image`) | 200 | wireframes cheap enough to be conversational (§5.2) |

**Lyria** (`lyria-002`) was also verified present. It is **not** in the plan. A music generator bolted onto a work companion would be a feature looking for a use, and the honest position is that we have not found one that survives contact with §2's day. If a real use appears — scoring a rendered walkthrough where Veo's native audio is dialogue rather than mood — it is a small addition to an artifact pipeline that will already exist.

---

## 12. Sequencing

Ordered by the §2 day, so each phase makes a real moment possible rather than shipping a capability with nowhere to land.

| | Delivers | Unblocks |
|---|---|---|
| **A. Artifacts & Canvas** | the noun, versions, export, canvas UI | every moment after 11:30 |
| **B. Documents & Retrieval** | ingest, embed, retrieve, cite, screen | 09:15, 22:00 |
| **C. Multimodal** | images in and out, brand memory | 11:30, 14:00 |
| **D. Meetings (Tier 1)** | transcript → plan | 10:00 |
| **E. Co-work** | share, comment, digest | 16:20, 07:40 |
| **F. Specialists & recovery** | legible capability, routes forward | throughout |
| **G. Meetings (Tier 2)** | live listening, opt-in | 10:00, deeper |

**A first, deliberately.** Documents without artifacts produce answers that vanish; images without artifacts produce pictures you cannot correct. The noun has to exist before the things that produce it.

---

*Sources for the research in §1: [Nano Banana 2 Lite & Omni Flash announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-omni-flash-nano-banana-2-lite/) · [Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/nano-banana-2-lite-and-gemini-omni-flash-available/) · [Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/overview) · [Meet REST API](https://developers.google.com/workspace/meet/api/guides/overview) · [OpenWorker](https://openworker.com/) · agent UX pattern surveys. Model ids and regional availability were verified against `alltheway-rinegan` rather than taken from the pages, and one page was found to be wrong.*
