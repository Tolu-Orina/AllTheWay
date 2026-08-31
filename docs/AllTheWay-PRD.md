# AllTheWay — Product Requirements Document

| Field | Value |
|---|---|
| **Document** | Product Requirements Document (PRD) |
| **Product** | AllTheWay |
| **Owner** | Product (Rinegan Solutions) |
| **Audience** | PM, engineering, design, GTM, finance |
| **Status** | Current as of 29 August 2026 |
| **Live product** | [alltheway.rinegansolutions.com](https://alltheway.rinegansolutions.com) |
| **Work started** | 22 August 2026 |
| **Companion specs** | [Requirements](AllTheWay-Requirements.md) · [Product Manifest v3](AllTheWay-Product-Manifest-v3.md) · [Memory Layer Plan](AllTheWay-Memory-Layer-Plan.md) · [Life Companion Design](AllTheWay-Life-Companion-Design.md) · [Technical Architecture](AllTheWay-Technical-Architecture.md) · [Production Roadmap](AllTheWay-Production-Roadmap.md) |
| **Authority on prices and limits** | `libs/metering` (not marketing copy) |

This PRD describes the product AllTheWay is, the jobs it must complete, who it is for, how it is packaged, and the conditions under which it is viable. Functional and non-functional requirements are summarised here and specified in full in the Requirements document. Where this document and marketing copy disagree, **this document and `libs/metering` win**.

---

## 1. Executive summary

AllTheWay is **one companion** a person talks to, that watches and acts for them, and that learns how they think — with everything it does visible enough to audit.

It is not a chatbot bolted onto an automation dashboard, and it is not three products for work, home, and church. It is a single identity, one memory, and one confirm-before-act floor, used across a working day that also contains a school run and a meeting.

**The problem it exists to close.** People already use a voice assistant, a notes app, a no-code automator, and a calendar. None of those share memory. None of them stop and ask before an irreversible step in a way the person can check. After a useful conversation, closing the tab usually means starting from zero. When the system *does* act, the person often cannot see what it read, which tool it called, or what it believed about them.

**The product thesis.** Trust is not a tone of voice. It is a set of checkable properties:

1. Ambiguous requests stop and ask (**Clarify Gate**).
2. Irreversible steps stop and wait for a yes (**Confirm Gate**), with a third path — **Not quite** — that is the learning signal.
3. Document answers cite a passage the person can open, or they say they could not ground the claim.
4. Meetings it joins **cannot speak** — a property of how it is built, not a setting.
5. What it has learned is on **You**, with evidence, and can be reverted. Revert stamps history; it does not delete it.
6. Cross-user retrieval is a breach, not a defect. The owner is in the Firestore path. A build guard fails if a collection-group query appears.

**What it is not.** It is not Cozi, Motion, a church CMS, or a kids’ app. Children and a partner exist as people in **her** account, not as logins. It does not silently reshuffle the calendar. It does not join someone else’s meeting as an unannounced guest bot. It does not train a profile from school-run chat or from voice transcripts unless the person opted to keep the transcript. Vertex AI Memory Bank is not the profile.

**Commercial shape.** Four plans, one currency (**£**), one table:

| Plan | Price | Who it is for |
|---|---|---|
| Free | £0 | Prove the companion in a real week |
| Plus | £18 / month | An individual who talks, uploads, and lets watchers draft |
| Team | £32 / seat / month | Sharing, audit, unmetered voice and watchers |
| Max | £60 / month | Video deliverables; draft cheap, render once |

**Viability, in one paragraph.** Working TAM for this category is **£14–20B / year** (AI work companions + personal automation seats). SAM is adults on the web, in English plus the seven UI languages, who already live in Google Calendar / Workspace — on the order of **£400–600M / year**. Twenty-four-month SOM is a UK-first, then English-speaking professional beachhead of about **40,000 paid accounts (~£10–12M ARR)** if Plus retains and Team lands in small firms. Plus LTV at 4% monthly churn and ~68% gross margin is ~**£300**; CAC must stay under ~**£100** for LTV/CAC ≥ 3. Max is sold at a thin video margin on purpose and must not be used to “make the unit economics look premium.”

**The fitness function for the whole product.** A new account can: talk through a plan, say **Not quite**, see one preference on You, have the next plan use it, reverse it without losing history, ask a cited question about an uploaded contract, and answer “when do I leave for pickup?” from Today without opening Google Calendar. If any of those fail, AllTheWay is not the product this PRD describes, however many collections exist.

---

## 2. Problem statement

### 2.1 The job that is failing today

A working adult — often a professional who is also the household’s default anticipator — already has:

| They use | For | What it does not do |
|---|---|---|
| Siri / Gemini / ChatGPT Voice | Quick spoken requests | Persistent, inspectable memory; confirm-before-act they can audit |
| Zapier / Make | “Watch this, then do that” | The same plan/trace as a conversation they drove themselves |
| Notion / Motion / calendar | Tracking work and time | Learn from corrections; stop before irreversible sends |
| “AI preferences” toggles | Stated taste | Reflect what they actually corrected in use |

None of these share a Cognitive Profile. A spoken “four items, collapsed” on the commute does not change tonight’s wireframe. A Zap that drafts from the inbox is a different product from the chat that explained the contract. The mental load of *anticipate → identify options → decide → monitor* (Daminger) is not reduced by adding a fifth tool she has to update.

### 2.2 Why now

- Voice is production-grade (Gemini Live, audio-to-audio, function calling).
- Goal-oriented multi-app agents are a proven paid category (Zapier Agents, Make Maia).
- The category has converged on **canvas + citations + visible memory**, not an infinite chat scroll.
- Image generation is cheap enough to be conversational (`gemini-3.1-flash-lite-image`). Video is expensive enough that it must be a deliberate deliverable, not a chat modality.
- Research (TEPA, Aug 2026) shows stale *active* memory is worse than no memory. A revert stamp is the right primitive; a black-box store that consolidates in place is the wrong one.

### 2.3 Cost of the status quo

- Re-explaining context every session.
- Acting on a fluent, uncited summary of a contract.
- A watcher that sent mail the person would not have sent.
- A family logistics app that only works if she types everything in.
- A “memory” she cannot see or put back, so she stops correcting it.

---

## 3. What AllTheWay is

### 3.1 One-sentence definition

**AllTheWay is a checkable companion:** it talks with you (text and voice), watches and acts for you under a ceiling you set, and remembers you from corrections you can inspect and revert — across work, home, and church as hats on one product, not as three apps.

### 3.2 The four pillars (product, not org chart)

| Pillar | Promise | What the person notices |
|---|---|---|
| **Collaborative partner** | Guided, stateful work | Clarify, a visible plan, a keepable artifact, citations |
| **Voice** | Talk like a person, not a form | Same memory as text; confirm before it acts |
| **Watchers** | Follow-through when they are not looking | Same plan and ledger as a session they drove; pause for review |
| **Governed trust** | Safe enough to connect mail and calendar | Identity, screening, registry, usage, Stripe entitlements |

v3 added the missing nouns the Collaborative Partner brief named and the day actually needs: **documents and retrieval**, **artifacts / Studio**, **meetings**, **co-work (share and comment)**. v3.5 is delivery and payment: first hour, Yes does a real thing, billing. Life design rebuilt **Today** as the next twelve hours, not a Studio lobby.

### 3.3 The four memories (kept apart on purpose)

Injection does not scale. Retrieval does not personalise. Life is not a preference string. Brand is not a contract clause.

| Store | Holds | Reaches the model by | Grows by | User control |
|---|---|---|---|---|
| **Preference** | How they like things done | Injected every turn (standing, non-proposed rows; unlabeled + active hat) | A human correction | Revert (and Accept on suggestions) |
| **Working** | This contract, that spec | Per-turn retrieval | Upload | Delete the document (embeddings go with it) |
| **Brand** | Palette, density, corners, look | Applied at image generate | An artifact correction | Revert that aspect |
| **Life** | People, places, rhythms, reminders | Today and calendar lookups — not the profile | Capture | Delete the entity |

Watchers, voice, and text **read** preference memory. Only a human correction **writes** it. That is source-weighting implemented as an absence: there is no watcher writer to under-weight.

Sleep-time synthesis may propose a new `source: "synth"` row (“you consistently shorten writing”). It never overwrites a human `session-*` row. Low confidence stays proposed and is not injected until accepted.

Vertex AI Memory Bank is an **optional extractor** behind this ledger (`MEMORY_BANK_RESOURCE`), restricted to `USER_PREFERENCES`. It is not the profile. Marketing “Built on” does not name it until it is actually invoked in production.

### 3.4 Hats, not products

`work` | `home` | `church` filter the day and optionally scope a memory row or a document. **All** (null) is everywhere. Unlabeled facts and unlabeled documents apply everywhere. Filename is never used to guess a hat. Quiet hours per hat are a Today concern, not memory.

### 3.5 What we refuse (locked)

| We will not | Why |
|---|---|
| A meeting bot that joins as a guest | **Superseded in part by [ADR 0007](decisions/0007-guest-notetaker-until-meet-media.md) (2026-08-31).** An *unannounced* guest bot remains a Won’t. A labelled, mute, host-admitted notetaker is allowed as a stopgap until Meet Media enrolment. |
| Claim the agent can speak in a meeting | Meet Media API is receive-only |
| Live multiplayer co-editing / CRDTs | Deferred; share → comment is the honest step |
| Native mobile or desktop apps | Voice and camera are the PWA; compose is desktop web |
| Video as a conversational modality | ~$0.75/s final render; a careless chat turn cannot cost a month of Plus |
| Watchers generating video | Unbounded liability |
| Cross-user retrieval | Breach, not a missing feature |
| Kids’ accounts / COPPA surface | Children are people in her account |
| Motion-style silent calendar reshuffle | Watchers propose; they do not add events until confirm |
| Mem0 / Zep / Letta as the profile | Wrong trust story (update-in-place or a different runtime) |
| Silent transcript training | Transcripts remain opt-in; not a synthesizer source |
| Claiming a tutor we do not have | Struggle writers exist (reask / miss). A quiz product does not |

---

## 4. How it works

### 4.1 A turn (text)

1. The person speaks or types in the companion or a session.
2. The **gateway** verifies the Firebase ID token. The browser never supplies a uid for retrieval and never holds a model credential.
3. The gateway loads **turn context**: standing preferences (hat-filtered, skipping proposed synth rows), retrieved passages (same hat rule), connected lookups (e.g. calendar), recent thread, and struggle rows.
4. Context travels to the **orchestrator** as A2A **metadata**, never concatenated into the user’s text (that shape is prompt injection).
5. **Clarify Gate:** if the request is ambiguous, the task is `INPUT_REQUIRED` — stop and ask, with tappable options where possible.
6. **Plan:** a visible plan streams (SSE). Citations are a field, checked against retrieved passages. Invented citations are dropped.
7. **Confirm Gate** if the plan would do something irreversible:
   - **Yes** — acts (calendar create and a kept artifact are the load-bearing “Yes does one real thing”).
   - **No** — nothing runs, nothing learned.
   - **Not quite** — they say what it should have been; that is a correction; the synthesizer keys and revokes.
8. Screening runs fail-closed on untrusted content (uploads, transcripts, watcher-ingested text). Any layer that blocks, blocks. A layer that errors, blocks.

### 4.2 Voice

Live chit-chat is a Gemini Live native-audio session through the **gateway WebSocket**. The browser talks only to AllTheWay. No `language_code` is sent; the model mirrors the speaker (including code-mixing). Igbo is not in the current Live language list; the product must not pretend otherwise.

The moment voice calls `plan_turn`, planning uses the **same** `loadTurnContext` as a typed turn. There is no separate voice memory. Ledger events from voice have the same structure as text (confirmed / corrected / declined).

Spoken confirm is the same floor as typed Yes. Irreversible actions do not execute on a low-confidence guess.

### 4.3 Watchers

A Watcher is a standing instruction: trigger (schedule, session ended, document indexed), goal, ceiling (`draft_only` | `send_after_review` | `send_automatically`).

Each run instantiates the **same** orchestrator graph. It is not a simpler engine. When clarify would fire and nobody is in session, the run pauses and notifies rather than guessing.

The **autonomy floor** is server-side: irreversible categories cannot be raised past review by a ceiling setting. Video is never available to a watcher.

Watchers **read** the profile; they do not write it. Untrusted inbox text is not evidence about the user.

### 4.4 Documents

Upload (desktop, camera, composer drop). PDF, text, markdown, photographs (transcribed, then screened). Max 25MB. Screen → chunk → embed → index under `users/{uid}/documentChunks`.

A turn retrieves passages for **that user only**. Citations open the passage that was already in the prompt. Deleting a document removes chunks. A share of an **artifact** never widens the corpus.

Hat is optional on upload. Unlabeled always retrieves.

**Explain again** and **I didn’t get it** write the struggle model. Opening the citation does not. A hit on a concept that does not exist writes nothing.

### 4.5 Studio (artifacts)

An artifact is a durable, versioned thing: document, image, video, summary, checklist. Version history stores the correction note. Brand memory is applied at generate time. Images are labelled as generated. Video is confirmed with cost; draft vs final is a product choice, not a model picker.

### 4.6 Meetings

Attempt live listen (Meet Media API) on meetings they host; fall back to transcript-after (Workspace Events) or the Chrome extension capture. The agent **listens; it cannot speak**. Everyone is asked before it connects. Commitments extracted from a call are **proposals** until confirmed.

Live insights back off (1, 3, 5, 10, 15, then every 15 minutes) so a 90-minute meeting is about ten reasoning passes, not ninety.

### 4.7 Today (life)

Google Calendar is the clock. AllTheWay is anticipation: who, where, **when to leave**, what is waiting on her.

Today shows the next twelve hours (calendar + rhythms), leave-now, waiting-on-you (digest + proposed commitments), capture (plan, remind, photo). Hats filter the timeline. They do not hide Work sessions.

Photo or file of a flyer **proposes** commitments. It does not add calendar events. Confirm still sits on the write.

Push: FCM on Chrome/Android/desktop; iOS only after Add to Home Screen, and copy must say so.

### 4.8 System shape (for PM, not an architecture dump)

Nine Cloud Run services, one GCP project. The **gateway** is the only process on the public internet. Internal calls are A2A with Google-signed identity tokens. Firestore is path-scoped per user.

| Service | Job |
|---|---|
| Gateway | Auth, turns, voice relay, retrieval as that user, metering, Stripe |
| Orchestrator | Clarify, confirm, plan graph |
| Librarian | Documents in, path-scoped passages out |
| Scribe | Meetings; cannot speak |
| Research cell | Bounded fan-out; workers never speak to the user |
| Connector gateway | The only path to Gmail / Calendar / Drive / Docs; autonomy floor |
| Watcher runtime | Standing instructions; owns unattended runs |
| Profile synthesizer | Corrections → keyed preferences; sleep-time proposals |
| Registry | Signed AgentCards, verified when you open Agents |

---

## 5. Users and personas

AllTheWay is **one adult account**. Org seats are the same person in a Team billing context, not a second product.

### 5.1 Primary: Maya — professional who also runs the household

- 32–45, UK or similar, bilingual or code-mixing (English + Yorùbá is a first-class case).
- Google Calendar is already the clock. School run, 9–5, church, kids’ clubs.
- Pays for tools if they remove a weekly pain she can describe to a partner in one sentence.
- Will not maintain a second family calendar. Capture must be cheaper than memory.
- Failure she will not forgive: a missed pickup; a confident wrong reading of a school policy or a contract; mail sent she did not see.

**Jobs:** When do I leave? What’s waiting on me? What’s in this document? Draft this, then remember I like it shorter. Watch the inbox for X and draft, don’t send.

**Plan:** Plus, unless she renders video (Max) or shares artifacts with a colleague (Team).

### 5.2 Secondary: Jordan — individual knowledge worker

- Designer, solicitor, founder, researcher.
- Wants a document guide, a design partner, a meeting scribe — **named specialists**, same floor.
- Shares a plan with one colleague (Team), not live multiplayer.

### 5.3 Secondary: Amara — Team admin / small firm

- 3–15 people. Needs sharing, a visible trail, unmetered voice/watchers.
- Will ask about SSO later (roadmap Phase 7). Must not be required for Team v1 if sharing and audit already exist.
- Autonomy-ceiling **waiver** for irreversible actions is an org-admin, auditable act — not a per-user toggle.

### 5.4 Anti-personas (do not design for)

- A child with a login.
- A second parent who needs a shared colour-coded household OS (Cozi).
- An enterprise CISO who needs EU-only residency on day one (open; `global` models make this harder).
- Someone who wants the agent to *talk* in the client’s Meet.
- A power user who wants Motion to silently defend focus time.

### 5.5 Accessibility and language

- Interface catalogues: English, French, Spanish, Portuguese, Chinese, Yorùbá, Welsh. Completeness is a build guard. Welsh plural mutation is real; `count === 1` is not an acceptable implementation.
- Voice: 85+ languages, auto-switch, code-mixing preserved. Do not “tidy” mixed speech into one language.
- WCAG AA, reduced motion, keyboard, contrast. A feature with no mobile behaviour is not finished: **capture and approve on mobile; compose and correct on desktop.**

---

## 6. User journeys (the day)

These are the journeys the product is designed around. Each must have a defined success signal.

| Time | Moment | Success |
|---|---|---|
| 07:40 | Commute, voice, “what’s today?” | Spoken answer **and** a glanceable Today (next 12 hours, leave-now, waiting-on-you) |
| 09:15 | 40-page supplier agreement | File in, screened, asked, **cited** answer |
| 10:00 | Meet with supplier | Notes / transcript → proposed commitments, not silent sends |
| 11:30 | “Show me a simpler onboarding” | Image artifact, labelled generated |
| 14:00 | “Too much blue, softer corners” | Next image constrained; You shows a palette row she can revert |
| 16:20 | Handoff to a colleague | Share artifact; they comment; she sees it |
| 22:00 | Understand the indemnity clause | Cited explanation; Explain again writes a struggle row; next explanation must differ |

Life overlay: school-run leave-now is a higher-severity miss than a quiet digest.

---

## 7. Features (catalogue)

Priority uses MoSCoW against **GA for Plus**. Team/Max extras are marked.

### 7.1 Companion and planning — Must

- Text turns (SSE) and voice (Live) on the same identity.
- Clarify Gate with options.
- Confirm Gate: Yes / No / Not quite.
- Plan panel and session thread persisted.
- Recovery routing on failure (retry, edit, do it manually) — not a dead end.
- Specialists as a **view** over the registry (Document guide, Design partner, Meeting scribe, Researcher), same orchestrator.

### 7.2 Memory — Must

- You: standing preferences with evidence; revert.
- Not quite → synthesizer key + TEPA revoke.
- Hats on corrections and documents; unlabeled default.
- Struggle model: reask / miss writers; revertible; injected as system context.
- Brand memory from artifact corrections.
- Sleep-time proposals; Accept to inject; never overwrite human rows.

### 7.3 Documents and retrieval — Must

- Upload, camera, drop; status visible (screening / indexing / ready / blocked).
- Grounded or silent; citation chip opens the passage.
- Delete removes embeddings, with copy that says so.
- Quota: 5 Free / 200 Plus / unmetered Team and Max.

### 7.4 Today and life — Must

- Next 12 hours; leave-now; hats; people / places / rhythms.
- Reminders (leave / start / prepare); in-app tray; FCM.
- Proposed commitments from indexed flyers; confirm to write calendar.
- Push opt-in on Today; iOS honesty.

### 7.5 Watchers — Must

- Create / pause / delete; ceiling; run history in the same product.
- Triggers: schedule (≥ 60 minutes), session ended, document indexed.
- Notify on unattended clarify.
- Must not write the Cognitive Profile.

### 7.6 Meetings — Must (Tier 1); Should (live)

- List with honest listen / read / none.
- Transcript screened; commitments as proposals.
- Live listen: host, opt-in, visible, cannot speak.
- Extension capture when hosted join is not possible.
- Insights metered (0 on Free/Plus; 300/seat Team; unmetered Max).

### 7.7 Studio — Must (images); Should (video)

- Images conversational; labelled; C2PA/SynthID preserved.
- Video: cost disclosed; draft vs final; never watchers.
- Canvas beside chat on desktop; sheet on mobile.

### 7.8 Co-work — Must on Team+

- Share artifact with a signed-in person; comment; resolve.
- Not live cursors.
- Shared-with-me index; access still checked on the owner’s path.

### 7.9 Trust chrome — Must

- Agents page: live signature verification.
- Usage remaining-first, from the gateway’s table.
- Connections: Google OAuth; irreversible still confirms.
- Digest: what ran, what waits, what needs a decision — from runtime state, not a snapshot that can lie.

### 7.10 Billing — Must

- Stripe Checkout + Customer Portal.
- Entitlement from subscription **status + tier**; unreadable → Free.
- Same plan table on marketing and in-product.

---

## 8. Functional requirements (summary)

The normative list is [AllTheWay-Requirements.md](AllTheWay-Requirements.md). This section is the PM-facing map.

| ID family | Concern |
|---|---|
| **FR-CORE** | Session, clarify, plan, confirm, ledger, acting on Yes |
| **FR-V** | Voice: same profile, confirm, degrade, ledger |
| **FR-W** | Watchers: define, trail, pause-for-clarify, ceiling + floor, CRUD |
| **FR-D** | Documents: screen, cite, delete, isolate, inspect retrieval |
| **FR-M** | Media: label, video confirm, screen uploads, revert brand, degrade |
| **FR-S** | Screening: every type, fail-closed, composition, trace |
| **FR-C** | Meetings: screen transcript, propose not act, host/opt-in, never speak |
| **FR-A** | Artifacts: version, export, provenance, correction → brand |
| **FR-SH** | Share/comment; never widen retrieval |
| **FR-L** | Today, leave-now, rhythms, capture, no surprise child/calendar writes |
| **FR-MEM** | Four stores, hats, struggle writers, synth proposals, no watcher writer |
| **FR-B** | Plans, meters, Stripe, refuse-before-exceed |
| **FR-I** | Auth, path isolation, no uid in librarian body, signed cards |

Non-functional: **NFR-SEC, NFR-PRIV, NFR-ISO, NFR-PERF, NFR-REL, NFR-COST, NFR-I18N, NFR-A11Y, NFR-OBS, NFR-OPS**.

---

## 9. Non-functional requirements (product-level)

### 9.1 Security and isolation

- Gateway is the only public service. Internal IAM identity tokens on A2A.
- Firestore: `users/{uid}/…` for user-owned data. No collection-group queries. Build guard.
- Librarian derives user from a scope token; no `uid` parameter a caller can spoof.
- Unrecognised subscription → Free. Usage counted after success; check before expensive effectors.
- No model credential in the browser.
- Fail-closed screening; a layer may only add a block.

### 9.2 Reliability and performance

- Clarify / first plan token: target p95 under a few seconds after warm instance; cold start is explained, not denied.
- Leave-now: within about a minute of due time (higher bar than digest).
- Voice: conversational latency; 15-minute Live cap handled by honest resumption, not a silent drop.
- Watcher schedule floor 60 minutes (product + cost).
- Meeting insights: backing-off schedule as a cost control.

### 9.3 Availability and operations

- Scale to zero is a cost principle; demo/prod may pin min instances.
- Terraform, Cloud Build on `main`, dev and prod workspaces.
- Healthz on services (including the trailing-slash Cloud Run quirk).
- DR: Firestore backup; Live regional behaviour documented. Memory Bank failover only if `MEMORY_BANK_RESOURCE` is set.

### 9.4 Internationalisation and accessibility

- Every new UI string in every catalogue in the same change. `check-locales.py`.
- Voice must not pin a language.
- WCAG AA; reduced motion; features keyboard-reachable.

### 9.5 Cost discipline

- Meter the expensive dimensions (voice, watcher runs, video, insight passes, stored documents).
- Do not meter ordinary text turns.
- Meeting transcript processing unmetered (cheap; metering it punishes the valuable behaviour).
- Pro/Flash split: Pro for final deliverables; Flash for routing and research workers; hard caps on research fan-out.

---

## 10. Information architecture

**Five destinations. Do not add a sixth Life app.**

| Nav | Job |
|---|---|
| **Today** | The next twelve hours, leave-now, capture, digest |
| **Work** | Sessions and plans (not her job calendar) |
| **Studio** | Artifacts, generate |
| **Watchers** | Standing instructions |
| **You** | Account, memory, documents, meetings, connections, usage, language |

Companion is persistent: conversation and canvas, not a third product. Agents/registry is trust chrome, not a primary consumer tab.

Empty states tell the truth (nothing learned yet; nothing waiting). They do not show seeded recents or a fake trace.

---

## 11. Monetization and packaging

### 11.1 Plan table (normative)

From `libs/metering`. Prices in pence. `None` = unmetered.

| | Free | Plus | Team | Max |
|---|---|---|---|---|
| Price | £0 | **£18** | **£32 / seat** | **£60** |
| Voice minutes / mo | 30 | 600 | Unmetered | Unmetered |
| Watcher runs | 50 | 1,000 | Unmetered | Unmetered |
| Connector calls | 200 | 5,000 | Unmetered | Unmetered |
| Documents stored | 5 | 200 | Unmetered | Unmetered |
| Images | 20 | 500 | 2,000 / seat | Unmetered |
| Draft video seconds | 0 | 20 | 60 / seat | 300 |
| Final video seconds | 0 | 0 | 10 / seat | 20 |
| Meeting insight passes | 0 | 0 | 300 / seat | Unmetered |
| Sharing | No | No | Yes | Yes |

Sharing is **Team and above**. That is where willingness to pay for handoff actually is.

### 11.2 Why Max exists

A final Veo render is ~$0.75/s. One 8-second clip is ~$6 — a third of Plus, in one click. Absorbing that into Plus would either bankrupt the tier or produce a limit that looks broken. Max exists so video can be honest.

```
Max revenue                £60/mo  ≈ $76
  300s draft @ $0.05/s    = $15
   20s final @ $0.75/s    = $15
  video cost (full use)   = $30    (~39% of revenue)
```

Video is a cost centre sold at a modest margin. If margin must improve, the lever is **final render seconds**, not draft.

### 11.3 Entitlement rules

- Stripe status `active` | `trialing` | `past_due` keep paid. `canceled` / `unpaid` / missing / corrupt → **Free**.
- Limits refused **before** exceed, with a sentence the person can act on (“Free keeps 5 documents. Delete one, or upgrade to Plus for 200.”).
- Voice minutes and watcher runs counted after the session/run succeeds; video and connector effects checked before invoke.

### 11.4 What is not a plan dimension

- Text turns.
- Transcript processing.
- Number of “AI preferences.”
- Hats (work/home/church) — one companion.

---

## 12. Product viability

Figures below are **planning estimates** for PM discussion. They are not a commissioned TAM study. Every number has a method and a sensitivity. Treat them as a model to argue with, not as a forecast to put on a slide without the assumptions.

### 12.1 Category

AllTheWay sells into the overlap of:

1. **Paid AI assistants / copilots** (ChatGPT Plus/Pro, Claude, Gemini Advanced, Microsoft Copilot).
2. **Personal and SMB automation agents** (Zapier Agents, Make, n8n).
3. **Work-and-life planning** (calendar + capture + reminders), without becoming a family OS.

It does not sell “AI for kids,” “church software,” or “enterprise search.”

### 12.2 TAM — total addressable market

**Definition.** Annual spend on AI companions and agents used by individuals and small teams for work and personal follow-through (assistants + agentic automation), globally.

**Top-down (working TAM).** Public 2026 ranges for generative-AI application software sit roughly $40–80B. The subset that is personal/SMB copilots and agents (excluding giant enterprise platforms and pure infrastructure) is taken as **15–25% → ~$8–20B**. Working TAM used here: **$18B (~£14B)** at the midpoint of that subset, rounded.

**Bottom-up cross-check.** ~1.0B knowledge workers globally × 8% ever paying ~$15/month blended ARPU = **~$14.4B**. Same order of magnitude. If either method is off by 2×, the strategy below still holds; the SOM does not require winning TAM.

**TAM we do *not* claim:** the entire Google Workspace seat count, the entire Zapier TAM, or “everyone with a calendar.”

### 12.3 SAM — serviceable addressable market

**Filters (all must hold):**

- Adult, one login (no child accounts).
- Web PWA (and Chrome extension for capture); not a store app.
- Willing to connect Google Calendar (clock) and optionally Gmail/Drive.
- UI in EN/FR/ES/PT/ZH/YO/CY *or* voice in Live’s language list.
- Accepts confirm-before-act (people who want fully silent automation are Zapier’s, not ours).

**Size.** OECD-style knowledge workers who already pay or trial AI tools: on the order of **40–80M** people. At £10/month blended willingness (mix of Free-never-pay and Plus): **£5–10B** is too wide. Tighter: 25M people who match filters × £18/year if 20% would pay Plus-like = **£90M**, which is too small because Team ARPU is higher.

**Working SAM:** 15M people who could pay Plus-or-above in our languages and surfaces × blended £30 ARPU/year (Plus-heavy, some Team) = **£450M / year (~$570M)**. Use **£400–600M** as the SAM band.

### 12.4 SOM — serviceable obtainable market (24 months)

**Beachhead.** UK and English-speaking professionals (including UK-adjacent bilingual households — Yorùbá is a wedge, not a locale afterthought), then small professional firms (legal, design, boutique consultancies) on Team.

**Capacity, not wish.** A 6–9 person team, UK-first GTM, product-led + communities, no enterprise field sales in year 1.

| | Year 1 | Year 2 (exit SOM) |
|---|---|---|
| Paid accounts (end) | 8,000 | 40,000 |
| Mix | 88% Plus / 10% Team seats / 2% Max | 80% Plus / 15% Team seats / 5% Max |
| Approximate ARR | ~£1.9M | **~£10.7M** |

Year 2 ARR sketch:

- 32,000 Plus × £18 × 12 = **£6.91M**
- 6,000 Team seats × £32 × 12 = **£2.30M**
- 2,000 Max × £60 × 12 = **£1.44M**
- **£10.65M ARR**

That is **~2% of SAM** at the £450M working figure — ambitious for 24 months, plausible if Plus retention holds and Team is a three-seat motion, not a 500-seat enterprise motion.

**Kill criteria for this SOM:** Plus monthly logo churn > 8% after month 6; Yes still does not complete a job; leave-now miss rate exceeds digest miss in support.

### 12.5 Unit economics — LTV / CAC

**Gross margin by shape of use (planning):**

| Mix | COGS drivers | Planning GM |
|---|---|---|
| Plus, text + light voice, no video | Flash, Firestore, Run | **70–75%** |
| Plus, heavy voice | Live minutes | **60–68%** |
| Max, full video allowance used | Veo | **~60%** blended on that account |
| Company blended (Plus-heavy SOM) | | **~68%** |

**Plus LTV**

- Price: £18/month.
- Monthly logo churn (target): **4%** → expected life 1/0.04 = **25 months**.
- Gross LTV = 18 × 25 = **£450**.
- Contribution LTV = 450 × 0.68 ≈ **£306**.

Sensitivity:

| Monthly churn | Life (mo) | Contribution LTV |
|---|---|---|
| 3% | 33 | £404 |
| 4% (plan) | 25 | £306 |
| 6% | 17 | £208 |
| 8% | 12.5 | £153 |

**Team LTV** (per seat): £32 × 30 months (stickier) × 0.70 ≈ **£672**. CAC is higher (sales-assist). Still works if CAC < ~£220.

**Max LTV:** £60 × 18 months (more discretionary) × 0.60 ≈ **£648**. Do not acquire Max with Plus-shaped ads; they will churn when they finish a video project.

**CAC (planning targets)**

| Channel | CAC | Notes |
|---|---|---|
| Organic / content / communities (Yorùbá, legal Twitter, design) | £40–70 | Year 1 default |
| Product-led (Free → Plus) | £20–40 incremental | If first hour produces a keepable artifact |
| Paid social / search | £90–150 | Only after activation is proven |
| Team (3-seat) | £180–280 per account | Not per seat |

**LTV/CAC target: ≥ 3 on Plus.** That means **blended Plus CAC ≤ ~£100**. If paid CAC is £120, do not scale paid until activation (below) is green.

**Payback:** at 68% GM, monthly contribution on Plus ≈ £12.20. CAC £80 → **~6.5 months**. Acceptable for this category if churn is 4%. If churn is 8%, payback exceeds life — paid is forbidden.

### 12.6 Activation and the conversion leak

People do not pay for architecture. They pay when a weekly pain is gone and stopping would hurt.

**Activation (must hit before scaling CAC):**

1. First session produces a **plan or cited answer** they did not have to seed.
2. **Yes** does one real thing (calendar event or kept artifact).
3. One preference visible on You after a Not quite, **or** Today answers leave-now from their calendar.

If the first hour is greeting + empty digest, **do not spend on acquisition**. That is the conversion leak v3.5 named.

### 12.7 Competitive position (why a Plus seat exists)

| Alternative | They win | We win |
|---|---|---|
| ChatGPT / Claude / Gemini | Breadth, brand, plugins | Inspectable memory, confirm floor, watchers on the same trail, hats, leave-now |
| Zapier Agents / Make | 1,000s of apps | Same graph as conversation; autonomy floor; not a second dashboard |
| Motion / Reclaim | Autopilot calendar | We refuse silent reshuffle; we suggest and confirm |
| Cozi / TimeTree | Household grid | We refuse to become the person who updates five tools |
| Notion AI | Docs they already have | Retrieval + citations + voice + watchers |

**Moat (in order of defensibility):** inspect / evidence / revert; path-scoped retrieval; autonomy floor; one companion across hats; TEPA-keyed profile. Not “we also have GPT.”

---

## 13. Success metrics

### 13.1 Product fitness (qualitative, weekly)

The Memory Layer fitness function plus Today:

1. Not quite → You shows one standing row with evidence.
2. Reverse → one standing row; old row has `revertedAt`.
3. “Too much blue” → next image constrained; revertible palette.
4. Cited document answer; delete removes retrieval.
5. Today: leave-now without opening Google Calendar.
6. Watcher run visible in the same digest as a session.

### 13.2 North-star and counters

**North star:** **Weekly jobs completed** — confirmed actions + cited document turns + leave-now notifications that fired on time. Not messages sent.

**Counters (what we refuse to game):**

- Message count.
- Watcher runs (can be noise).
- Video seconds (cost, not value).

### 13.3 Funnel (instrument)

| Stage | Definition | Target (Plus path, month 6) |
|---|---|---|
| Signed up | Auth success | — |
| Activated | Fitness 1 or 5 within 7 days | **≥ 40%** |
| Plus convert | Checkout success | **8–12%** of activated |
| Plus retained M1 | Still paid day 30 | **≥ 85%** |
| Plus retained M3 | | **≥ 70%** |

### 13.4 Quality / trust SLIs

| SLI | Bar |
|---|---|
| Grounded citation accuracy (eval set) | **> 95%** (FR-D2) |
| Screening: known injection blocked | **100%** on the corpus we maintain |
| Cross-tenant retrieval in tests/guards | **Zero** |
| Leave-now miss (fired > 2 min late) | **< digest miss rate** in support |
| Confirm skip on irreversible | **Zero** (floor tests) |

### 13.5 Engineering SLOs (from roadmap)

- p95 Clarify / first plan on warm instances.
- Voice round-trip.
- Watcher trigger-to-first-visible-state.
- Cost per active user broken out: text, voice-minute, watcher-run, video.

---

## 14. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fluent wrong answer about a document | M | **Critical** | FR-D2 structural (citation field + grounding check). Never soften for fluency. |
| Prompt injection via PDF / transcript / email | H | Critical | FR-D1, FR-C1, FR-S1–S2. Fail-closed. Watchers do not write profile. |
| Cross-tenant retrieval | L | Critical | Path-scoped storage, no collection groups, scope token, owner assert, build guard. |
| Stale active memory (TEPA) | M | High | Keyed revoke; You + revert; proposed synth not auto-injected. |
| Work/home contamination | M | High | Hats; unlabeled default; no filename inference. |
| Voice confirm friction | M | High | Same floor as text; pre-authorize only below the irreversible floor. |
| Watcher sends the wrong mail | M | Critical | Ceiling + server floor; pause for clarify; visible run. |
| Video cost runaway | M | High | FR-M2; never watchers; Max as the honest tier. |
| `global`-only image/video models vs EU residency | H | Medium | Recorded cost of the feature; residency is an open decision, not a silent promise. |
| Meet Media API stays preview-constrained | H | Medium | Tier 1 + tab capture remain. Labelled mute bot is the stopgap ([ADR 0007](decisions/0007-guest-notetaker-until-meet-media.md)); unannounced join remains a Won’t. |
| Plus churn from “it planned, it didn’t do” | H | Critical | Yes must act (calendar + artifact). Activation gate before paid ads. |
| Locale / i18n half-translation | M | High | Guard; native review of machine catalogues before calling them shipped. |
| Cold-start perceived as product-broken | H | Medium | Min instances where it matters; copy that does not lie. |
| Stripe / entitlement drift | M | High | Metering library is authority; unreadable → Free. |
| CAC before activation | H | High | No scaled paid until activation ≥ 40%. |
| Claiming a tutor | L | Medium | Struggle writers only; marketing stays on inspectable memory. |
| Kids’ data / COPPA | L | Critical | No child logins; school paper is *her* document. |
| Memory Bank treated as profile in GTM | M | High | Docs and “Built on” already forbid it until invoked. |

---

## 15. Constraints, dependencies, open decisions

### 15.1 Constraints

- Vertex is the model API; there is no model emulator. Local uses a fake provider unless `USE_VERTEX=true`.
- Live models: no reliable mid-call specialist hand-off. Research-style work is queued as a visible plan step.
- Meet Media API: receive-only, preview enrolment, host present, refuses underage / E2E / watermarked meetings.
- iOS Web Push only after Home Screen PWA.
- Drive connector is `drive.file` (files this app created or the user opened), not the whole Drive.

### 15.2 Out of scope (this PRD’s GA)

- Native iOS/Android/desktop apps.
- Live co-editing.
- Guest meeting bots.
- Lyria / music generation.
- Household sharing OS (partner **view-share** is a later ADR).
- EU-only residency as a sold SKU.
- Connector marketplace beyond first-party Google set + registrable MCP (roadmap).

### 15.3 Open decisions (do not quietly resolve in engineering)

1. **Currency for GTM outside the UK** — code is £. A mixed £/$ table is a bug.
2. **Team final-render seconds** — 10s/seat is a tight ratio; zero and push to Max is a valid PM call.
3. **SSO / IdP** — Team v1 vs Phase 7.
4. **Gmail inbox watch** — CASA / restricted scopes; do not pretend inbox watch is Free-path.
5. **EU residency** vs `global` image/video models.
6. **When to name Memory Bank in marketing** — only after `MEMORY_BANK_RESOURCE` is actually called in production.

---

## 16. Go-to-market (product implications)

- **First hour:** calendar connected or a document cited or a Not quite learned — one win.
- **Wedge:** bilingual UK professionals + people who already distrust silent agents.
- **Do not lead with Studio video.** It is Max, expensive, and the wrong first screenshot.
- **Do lead with:** Today + cited documents + “it asked before it sent.”
- **Team:** share a contract summary / wireframe, not “AI transformation.”
- Support: leave-now misses are P1; digest misses are P3.

---

## 17. Roadmap (product, not sprint board)

Hackathon / Milestone 1.1 is in the past as a checkpoint, not the ceiling.

| Horizon | Outcome |
|---|---|
| **Now (in production)** | Companion, gates, voice, documents, artifacts, meetings ladder, watchers, You, Today, hats, struggle writers, sleep-time proposals, Stripe, seven UI languages |
| **v3.5 completion** | Every primary click completes a job; Yes always acts; marketing table = meter |
| **Phase 7–8 (roadmap)** | Full org policy, SSO, formal security review, growth instrumentation |
| **Phase 9–10** | SLOs under four traffic shapes; GA operating cadence |
| **Later ADRs** | Partner view-share; Gemma as second screener if not already composing; EU residency |

---

## 18. Glossary

| Noun | Meaning |
|---|---|
| **Today** | Morning surface. Do not rename to Home. |
| **Work** | Collaborative sessions, not the job calendar. |
| **You** | Account + inspectable memory. |
| **Companion** | The conversation that plans and confirms. |
| **Hat** | `work` \| `home` \| `church`. Filter, not a product. |
| **Person / place / rhythm / reminder / commitment** | Life entities. No child login. |
| **Clarify Gate** | Stop when ambiguous. |
| **Confirm Gate** | Stop before irreversible. Yes / No / Not quite. |
| **Autonomy floor** | Server-side minimum review for irreversible actions. |
| **Watcher** | Standing instruction. Same graph as a session. |
| **Artifact** | Versioned deliverable. |
| **Cognitive Profile** | Firestore preference ledger + struggle + brand. Not Memory Bank. |
| **Waiting on you** | Decisions, clarify, proposed commitments. |

---

## 19. Document history

| Date | Change |
|---|---|
| 2026-08-29 | First complete PRD for PM, aligned to shipped metering, Memory Layer A–D, Life design, Manifest v3 |

**Related:** [AllTheWay-Requirements.md](AllTheWay-Requirements.md) is the requirements specification (high-level and low-level) that this PRD authorises.
