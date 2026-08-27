# AllTheWay v3.5 — Product Design Enhance

### Make what we already built feel like a product someone would open tomorrow, and pay for

*Does not supersede Product Manifest v3. v3 scoped capabilities. This document scopes **delivery, perception, and payment** — the gap between a working system and a product a person with a job and a life would actually keep.*

**Date:** 2026-08-27 · **Status:** proposed · **Horizon:** v3.5, not v4 · **Companion docs:** [Product Manifest v3](AllTheWay-Product-Manifest-v3.md), [v3 Implementation Plan](AllTheWay-v3-Implementation-Plan.md), [A2A and Platform Plan](AllTheWay-A2A-and-Platform-Plan.md)

---

## 0. What v3.5 is, and what it is not

v3 asked: *what does it feel like to work with this, all day, for everything?* and answered with artifacts, documents, meetings, canvas, specialists, digest, share.

v3.5 asks a different question, because the code review says v3's nouns are largely *present* and still largely *unfelt*:

> As someone with a personal life and a work life, why would I open this on a Thursday, and why would I pay?

That is a product-design question, not a capability question. The answers live in first-run, information architecture, empty states, what a click actually does, how work and home share one companion without becoming a junk drawer, and the billing loop that was deferred on 2026-08-26.

**v3.5 is not v4.** Meet Media API hardening, EU residency, native apps, live co-editing, more connectors, and a second screening model (Gemma) stay where the v3 plan put them. This version does not add a new pillar. It makes the existing ones reachable, honest, and sellable.

**The one-line brief**

Ship a first hour that produces a real win without a seed database; make every primary click complete a job; **make Yes do one real thing** (calendar + a kept artifact); put billing behind Stripe without moving entitlement out of `libs/metering`; and redesign the shell so the companion is the product, not a panel beside a catalogue of features.

---

## 1. Executive diagnosis

### 1.1 The substance is real. The product is hard to perceive.

This is not a thin demo. The gateway speaks to the orchestrator over A2A. Text turns stream over SSE. Voice rides a WebSocket relay with Firebase auth on the first message and no model credential in the browser. Watchers pause. Preferences revert. Documents upload, screen, and index. Artifacts version, export, share, and take comments. Meetings list with an honest listen/read/none label. Usage reports remaining allowance. The registry shows signed cards.

A person signing in for the first time does not meet that system. They meet:

- a Home screen whose "Transparent Trace" is three hardcoded sentences that did not happen to them (`web/src/app/screens/Home.tsx`)
- a sidebar of "Recents" pointing at `grant`, `contract`, and `nav` — ids that only exist if `seed.ts` ran against the emulator
- a **New** button in three places, none of which create anything
- a search box that does not search
- a bell that does not notify
- a Profile page that is every v3 surface stacked in one scroll (preferences, visual preferences, language, transcripts, shared-with-me, meetings, documents, usage, connections)
- a Watchers page with no way to create a watcher
- a Sessions page whose empty-state CTA is also a dead button
- a marketing pricing table that disagrees with the meter that actually enforces plans

The feeling this produces is the opposite of the brand: *it talks a bigger game than it plays*. Trust is the product's thesis. A click that does nothing is a trust failure in the same family as a confident wrong summary of a contract.

### 1.2 Is it only voice that works?

**No.** Text is wired. The companion panel's comment still says "Replies are local-only — this panel does not call the gateway yet" (`CompanionPanel.tsx`), but the thread uses `useTurn("companion")`, which calls `streamTurn` on `/api/sessions/:id/turn/stream`. Session detail has the same path, plus clarify chips and a confirm gate that **records a ledger row and does not run the plan**. The copy on Yes — "Recorded. Nothing has run yet — connectors arrive in the next phase" — is not stale marketing. The orchestrator card says it never executes; `connector-gateway.invoke` is never called from a companion or session confirm. Google Calendar and Gmail send are real MCP servers sitting behind a door nobody opens.

Voice is the *most complete conversation loop*: mic on Home, mic in the companion composer, captions, interrupt, gateway relay, Vertex 2.5 native audio, minute metering in the relay. It is not a complete *job* loop. Spoken confirm has no Yes/No buttons (`VoiceCaptions` is text). Minutes are recorded on hangup; an over-limit user can still connect. Voice and text do not share a session: companion text is the constant `"companion"`; voice picks an in-progress session, else the first session, else `"live"`.

Text is wired and still *orphaned*. There is no `POST /sessions`. `listSessions` is `orderBy("updatedAt")`. A Firestore document that only has subcollections has no fields, so it never appears in that query. The v3 plan already recorded this (`§16.5`): even a working conversation cannot populate the list. The "New" buttons cannot fix it, and should not — a session should be a consequence of talking, titled from what was said.

So the honest answer to "is it intuitive upon clicks, or only voice?":

| Action | What happens today |
|---|---|
| Speak on Home | Voice session starts. This is the one complete "just start" path. |
| Type in the companion | A turn runs against the fixed id `companion`. No session row appears in Sessions. |
| Type in a session you opened from the list | A plan streams — if a seeded or stored session exists. Confirming it writes the ledger and stops. |
| Click **Yes, go ahead** (session detail) | `POST /sessions/:id/decision`. Nothing is sent, scheduled, or drafted. |
| Click a confirm chip (companion) | Sends "Yes, go ahead" as a **new turn**, not `recordDecision`. Two UIs, two meanings. |
| Click **New** (top bar, Sessions header, empty state) | Nothing. No `onClick`, no route. |
| Click a Recent | 404 or empty, unless emulator seed ran. |
| Search | Decorative input. |
| Bell | Decorative button. Mobile header avatar is not a menu. Sign-out lives in the desktop sidebar and the desktop account menu. |
| Create a watcher | No UI and no `POST /watchers`. Pause/resume of an existing row is real. Nothing publishes to `watcher-trigger`; a run that did fire would plan and return `"done"` without calling a connector. Gmail cannot watch the inbox (`gmail.readonly` is not implemented). |
| Upload a document | Real pipeline (screen → chunk → embed). Library lives on Profile. Drop-on-composer uploads, then asks you to type about it. |
| Open Canvas | Store is real. **No turn creates an artifact.** Empty until a human pastes. Shared-with-me links go to `/app/artifacts/:id`, which is not a route. |
| Connect Google | Real OAuth. Calendar/Drive/Docs APIs work in connector-gateway. Companion cannot reach them. Drive is `drive.file` only (files this app created). |
| Open a shared artifact | 404. |
| Approve a meeting commitment | `CommitmentCard` and `api.confirmCommitment` exist; neither is mounted. |
| Pay | Impossible. `subscriptions/{uid}.tier` is a Firestore field set by hand. The Plus CTA is `/signup?plan=plus`, which signup does not read. Team CTA is `/contact`, which is not a route. |

Clicks are not uniformly dead. They are *uneven*: some complete a job, some decorate, some 404. Uneven is worse than sparse, because the user cannot tell which kind they are about to hit.

### 1.3 Why a person with a job and a life would not pay today

People do not pay for architecture. They pay when a tool removes a weekly pain they already feel, in a way they can describe to a colleague or a partner, and when stopping would hurt.

Today AllTheWay asks them to assemble that sentence themselves, from five nav items and a Profile scroll. The landing page promises "voice, autonomous watchers, and a memory that is yours to inspect." After signup they get a greeting, a quiet digest, and a fake trace. The memory is empty. The watchers do not exist. Voice is a control in the corner.

That is the conversion leak. Billing cannot close it. Charging for a product whose first hour does not produce a keepable artifact is how you get chargebacks and "I tried it, nothing happened" reviews.

---

## 2. Code-grounded capability audit

Read against `web/src`, `services/gateway`, `libs/metering`, and the v3 plan's own known-gaps list. Docs were used as a map, then the map was checked against handlers and components.

### 2.1 Capability matrix

| Capability | In code | Reachable in UI | Completes a job for a new user | Notes |
|---|---|---|---|---|
| Text turn (SSE) | Yes | Companion + session detail | Partial | Wired; sessions don't materialise; companion comment is stale |
| Voice (Live 2.5 native audio) | Yes | Home + companion mic | **Yes** | Strongest loop. Igbo unsupported. 15-min audio cap → resumption in relay |
| Clarify / Confirm gates | Yes | Session detail (full); companion (chips) | Gate is visible; **acting is not** | Orchestrator plans only. Session Yes = ledger. Companion Yes = another turn. Voice confirm = speak it |
| Recovery routing | Component exists | **Not mounted** | No | `Recovery.tsx` is never imported. Session detail has a retry link only |
| Sessions list / detail | Read API only | Nav | Empty for new users | No create. Turns do not write `plan`/`done`. `POST /sessions/:id/end` exists; UI never calls it, so the profile synthesizer rarely runs |
| Watchers | Runtime + list + pause | Nav | No | No create. No publisher to `watcher-trigger`. Runs not quota-checked before. Inbox trigger impossible without Gmail read |
| Cognitive profile | List + revert | Profile | Empty until corrections | Good empty copy. Hard to find |
| Documents | Upload/delete/status | Profile + composer drop | Hidden | 25MB, screening stages, camera capture on mobile. Library is not a destination |
| Retrieval at turn time | Gateway `retrieve` | Invisible | Unknown to user | Citations as UI (v3 R3) still thin |
| Artifacts / Canvas | CRUD, versions, export, comments, share | Companion "Work" tab | Empty | Nothing in a turn, watcher, or media path creates an artifact. Correction is a user edit |
| Digest | `GET /digest` | Home | Often falsely quiet | Runtime writes `state: "awaiting_review"`; digest filters `status == "awaiting_confirmation"`. Decision links go to the sessions **list**. Tests encode the wrong field |
| Meetings | List, insights, opt-out | Profile | Inspect + consent | Switch never hydrates. `confirmCommitment` / `extendMeeting` unused. Live insights allowance is 0 on Free/Plus |
| Specialists | View over registry | Agents screen | Display only | Clicking a specialist does not start that kind of work |
| Agent registry | Live cards | Agents | Governance, not a job | Correct for trust; wrong as a primary tab for consumers |
| Connectors | Google OAuth | Profile | Hidden | Calendar real; others `coming_soon` from server. Drafts scope opt-in |
| Usage meters | `GET /usage` | Profile | Advisory only | Remaining-first. No upgrade CTA. Near-limit copy exists |
| Push tokens | Register API | Bell is dead | No | Digest cannot tap you on the commute |
| Billing / checkout | **No** | Pricing on marketing only | Cannot sell | Open decision 5. Metering complete |
| Onboarding | Language offer on Home | Partial | No job-to-be-done | No "what are you here to do" |
| i18n of chrome | `t()` + 7 locales | App shell | **Auth risk** | `I18nProvider` wraps `AppLayout` only. Login/signup/verify/forgot/reset/offline all call `useT()` and can throw before paint. Six catalogues unreviewed (`§16.5`) |
| Marketing ↔ product | Separate | Landing | Contradicts meters | See §2.3 |

### 2.2 Dead, stale, or misleading chrome

These are not taste issues. They teach the wrong model of the product.

1. **`AppTopBar` New** — brand button, no handler (`AppTopBar.tsx`).
2. **Sessions New + empty-state Start** — same (`Sessions.tsx`).
3. **Search** — placeholder "Search sessions, watchers, anything…", no submit, no `/` shortcut despite a kbd hint.
4. **Bell** — `aria-label="Notifications"`, no state (`AppLayout.tsx`).
5. **Mobile header Avatar** — not `AccountMenu`. Account menu only renders inside the desktop top bar (`hidden lg:flex`). Sidebar sign-out is `hidden … lg:flex`. On a phone, sign-out is missing. `AccountMenu.tsx` exists specifically to fix this and is not used where the bug lives.
6. **Sidebar Recents** — three hardcoded labels (`Sidebar.tsx`).
7. **Home TRACE** — three hardcoded governance sentences, presented as this user's trace.
8. **`/contact`** — Team CTA, footer, and closing CTA. Not in `App.tsx` routes. Footer also 404s `/about`, `/blog`, `/careers`, `/security`, `/trace`, `/status`, `/privacy`.
9. **`/signup?plan=plus`** — query ignored.
10. **Companion "local-only" comment** — false; confuses the next implementer.
11. **Session confirm copy** — true, not stale. Treat as a product hole (§2.5), not a string to delete.
12. **Meetings global switch** — does not read current setting, so a refresh looks like consent was withdrawn.
13. **Watchers empty** — `Async` without `isEmpty`; a new user sees a blank list and a policy footnote.
14. **SharedWithMe links** — `/app/artifacts/:id?owner=` is not a route.
15. **Auth + offline `useT()`** — provider missing; first-run can crash before the product.
16. **Pricing block vs `libs/metering`** — see next section.

### 2.3 Three sources of truth for the plan, none of them the product

| | Landing `pricing.tsx` | `libs/metering` | Manifest v3 §10 |
|---|---|---|---|
| Currency | **$** | **pence / £** | £, with an open $ vs £ question |
| Free | "No Watchers", "text only", "one session" | 50 watcher runs, 30 voice minutes, 200 connector calls, 20 images | documents/images/video added |
| Plus | $18, "up to 3 Watchers", "fair-use minutes" | £18, 600 minutes, 1000 runs, 20s draft video, 0 final | same shape as metering |
| Team | **Custom**, SSO, "talk to us" | £32/seat, unmetered voice/watchers, 10s final video, 300 meeting insights | sharing Team+ |
| Max | **absent** | £60, video is the reason it exists | present |

`scripts/check-plan-table.py` exists so the UI cannot drift from the meter. The marketing page is not on that guard. A person who signs up from "No Watchers" and then has watcher runs, or who expects Team to be a sales conversation while the meter has a price, will not trust the next number either.

v3.5 closes this by making **`libs/metering` the only plan table**, served to both the marketing page and `/api/usage`, and by putting Stripe products on the same four `lookup_key`s: `free`, `plus`, `team`, `max`.

### 2.4 Safety and quality that must not regress

v3.5 is allowed to hide, regroup, and complete loops. It is not allowed to soften:

- Fail-closed screening; a layer may only add a block
- Confirm before irreversible; labels are not trusted
- Unrecognised / unreadable subscription → Free
- Usage counted after success
- Retrieval scoped by path, no collection-group queries
- No meeting bot that joins as a guest
- No model credential in the browser
- Grounded or silent on documents
- Video never available to a watcher
- Reduced motion, contrast, keyboard reach

If a redesign makes the confirm gate quieter in order to feel "snappier", it has failed this version.

### 2.5 The acting gap — the product stops at "here is a plan"

This is the finding that changes what v3.5 has to ship, not only how it looks.

The stack is a **metered, gated planner** with document RAG and meeting records, sitting in front of **unwired effectors**. Connector-gateway `invoke()` is the only place `check()` actually refuses work (connector calls, images, video). Voice minutes and watcher runs are counted after the fact and not refused before. Sharing is gated at grant time. Everything a user thinks of as "do it" — send the mail, put it on the calendar, drop a draft on the canvas, fire the watcher — never reaches `invoke`.

Consequences:

1. **Confirm cannot be only a ledger in v3.5.** A paid companion that asks permission and then does nothing is worse than one that never asked. Wire **one** effector through Yes: Google Calendar create (the connector that already works without restricted Gmail scopes). On Yes, also persist the plan as an artifact so Canvas is not a museum.
2. **Do not sell inbox Watchers.** Gmail read is not implemented (restricted / CASA). Create-watcher copy must use triggers we can actually observe (time, calendar, a document changing, a session ending) or it will be the Recents bug at product scale.
3. **Digest "quiet" is sometimes a bug.** Align `awaiting_review` / `awaiting_confirmation` and `summary` / `detail` in the same cut as Today. Otherwise the morning surface lies.
4. **Voice over-limit must fail closed at connect**, the same way meeting insights skip a pass. Recording minutes after hangup is not a limit.

Gmail send, Drive, Docs, and image/video MCP can stay behind the same confirm door; they do not all have to light up in v3.5. Inbox watch and CASA stay v4.

---

## 3. The first hour, as the code actually plays it

Walk a new account, no emulator seed, phone then laptop.

**Minute 0 — landing.** Hero: "Finally, an agent that goes all the way with you." Two CTAs: Start free, See how it works (`#voice`). Pricing below contradicts the meter. Team talks to a 404. Trust section is strong (inspectable memory, confirm before acting). The visitor cannot tell whether this is a voice app, a meeting app, or ChatGPT with extra steps.

**Minute 2 — signup.** Real auth. No plan captured. No "what are you trying to do". Lands on `/app`.

**Minute 3 — Home.** Date and greeting work (clock + display name). Digest is quiet. No in-progress plan. Watcher runs empty. Fake trace. Language offer may appear. Mic is the only obvious verb. On a phone the companion is a floating button, not the page.

**Minute 4 — if they tap the mic.** Voice can work. When it ends, nothing glanceable remains except perhaps captions. The commute moment the manifest described is half-built: speech without a digest of *their* day.

**Minute 5 — if they type.** Companion turn may run. Sessions list still empty. They cannot "continue" anything tomorrow.

**Minute 8 — they explore tabs.** Sessions: empty, dead New. Watchers: empty list, policy text. Agents: signed cards for librarian, orchestrator, scribe, research-cell — impressive and alien. Profile: a settings dump that contains the actual product (files, meetings, Google, usage).

**Minute 12 — they leave.** They can describe the brand. They cannot describe a result they now own.

That hour is the whole commercial problem. Competitors who convert spend it producing an artifact or clearing a queue, not introducing architecture.

---

## 4. Competitive research: how the category actually sells

Research date: 2026-08-27. Sources at the end of this document. Rankings in vendor blogs were treated as marketing; purchase reasons and complaints were taken from reviews, cancellation essays, and consistent cross-source patterns.

### 4.1 The market AllTheWay actually sits in

AllTheWay is not one competitor. It overlaps five paid categories. That is a positioning hazard: a product that is 40% of five tools loses to the tool that is 100% of one pain.

| Category | Who people pay | Price band (individual) | What the money is for |
|---|---|---|---|
| Generalist AI | ChatGPT Plus, Claude Pro, Gemini | ~$20/mo | Limits, better model, voice, canvas/artifacts, images |
| Research | Perplexity Pro | ~$20/mo | Cited answers, file research, higher Pro Search caps |
| Meeting notes | Granola, Otter, Fireflies, Fathom | ~$0–$18/user | Transcripts → notes → action items, CRM for sales |
| Autonomous admin | alfred_, Lindy, "AI EA" tools | ~$30–$100/mo | Inbox/calendar that runs without a prompt |
| Premium workflow | Superhuman, Motion, Reclaim | $10–$40/mo | Speed or calendar defence, not "intelligence" |

Plus a graveyard of personal-AI that asked to be a friend (Replika, early Pi) and a graveyard of gadgets that asked to be an operating system (Humane, Rabbit). AllTheWay should learn from both: **be a worker with a voice, not a personality with a chat box.**

### 4.2 Why people pay $20 for ChatGPT / Claude (and what they think they bought)

Honest reviews in 2026 converge on a sentence the category does not put on the pricing page:

> I am not paying for intelligence. I am paying so I am not cut off mid-flow.

Claude Pro is described as a **flow-state subscription**: five-times usage, priority when busy, heavier models. The reviewer who has paid for two years says the product is "so the 11pm side-project hour is not interrupted by a cap." ChatGPT Plus is the **toolkit subscription**: voice, images, canvas, browsing, memory, custom GPTs. People who pay for both say they are different tools, not two brands of the same model.

**Canvas vs Artifacts** is the interface finding that matters for us. ChatGPT Canvas is iterative writing (inline edit, section rewrite). Claude Artifacts is a side pane that *renders* the thing (doc, chart, small app). Reviewers treat both as **paid-tier reasons**, and both as the answer to "chat does not scale past a few steps" — the same sentence as v3 §1.5.

**Implication:** AllTheWay's canvas is the right shape. It is currently a second tab inside a side panel, empty, with no first artifact. We have the category's paid feature in the product's least discoverable slot.

### 4.3 Why people pay for meeting notes — and the bot tax

Granola, Otter, Fireflies, and Fathom sit at roughly the same individual price as Plus. Differentiation is not accuracy. It is **social cost and where the note goes**.

- **Granola** is paid for *discretion*: no bot in the participant list, notes that feel like yours. VCs and consultants say they never have to explain an AI attendee to a client. Weakness: limited history on free, no replay, Mac-weighted, languages far behind our voice surface.
- **Otter** is paid for *live captions and a shared archive*. Safe default, more recording overhead.
- **Fireflies** is paid for *CRM*: HubSpot/Salesforce, sales analytics. Cheapest annual Pro in several comparisons (~$10/user). Individual users call it more system than they wanted.
- **Fathom** is paid for *a free plan that is actually usable*, then Premium (~$20) for Ask-Fathom, templates, bot-free capture. The default bot is the most-cited complaint; bot-free is the upsell. Sales teams pay Business (~$34) for CRM fields. Everyone else is told to stay free.

**Our position is already written and it is a commercial asset:** we will not join as a guest bot; Tier 1 reads the transcript after; live listen is host-only, receive-only, labelled. Granola proved people will pay *more* for the absence of a bot. Fathom proved the bot is what they resent. v3.5 should sell that absence in the UI, not hide meetings on Profile under a switch that forgets its state.

### 4.4 Why people pay for an AI executive assistant

alfred_ (~$30 flat) and Lindy win reviews when they **run without a prompt**: inbox triage, drafts in your voice, calendar, morning brief. The Rhumbix case (vendor-reported) is the pattern every EA tool sells: connect calendar and mail, five-minute setup, work delegated the same day. Independent testers make the same cut: ChatGPT is thinking work; alfred_ is the 11.7 hours of email.

The design principle that shows up in founder write-ups is **"draft, do not send."** Approval in the loop is not a lag. It is why they trust it. That is our Confirm Gate, already built, currently invisible until a turn proposes an irreversible action — which a new user may never trigger.

**Our Watchers are this category.** They are unlistable for a new user and uncreatable in the UI. We built the harder half (ceilings, screening, pause) and omitted the verb "watch this for me."

### 4.5 Why people cancel: Superhuman, Motion, Reclaim, and the $103/month essay

A June 2026 cancellation essay (six subscriptions, $103/month back, "my workflow didn't change") is more useful than a feature matrix. The pattern:

> Subscription bloat almost never comes from bad software. It comes from subscribing to a better version of yourself.

Specific complaints that map onto us:

- **Motion** — the AI moved the calendar. Technically correct, felt wrong. Trust took weeks to rebuild. Reviews knock a star off for autonomy they did not want. Motion has no free tier, so every reviewer paid before they understood the curve.
- **Reclaim** — simpler, free Lite exists, "works on day one." People still leave over sync duplicates and account-deletion friction. Calendar products are punished when they are hard to *leave*.
- **Superhuman** — genuinely faster for 100+ emails/day; most people should not pay $30. Onboarding is a coached call. Polarised reviews are mostly mismatch: status purchase vs actual volume.
- **Sunsama / Capacities / Readwise** in that essay — tools that created a ritual instead of removing one.

**Implication for AllTheWay:** Watchers and meeting listen must default to *propose*, not *rearrange someone's life*. The autonomy floor is a sales feature if we show it. If the product feels like Motion (things moving you did not ask to move), we will inherit Motion's 4.1-star trust problem without Motion's scheduling payoff.

Also: **easy off-ramp**. Billing in v3.5 must include Customer Portal cancel, data export, and disconnect of Google in the same Account area. Products that trap calendars get 1-star "hostage" reviews that drown the product story.

### 4.6 Perplexity and the citation premium

People who pay Perplexity Pro (~$20) say they buy **answers they can check**, file upload, and not hitting the free Pro-Search wall. They do not buy it as a companion. Complaints cluster on support, refund windows, and "it's search, not a conversation."

**Implication:** FR-D2 (grounded or silent) is not only safety. It is the Perplexity-shaped reason a solicitor or a student pays. If citations stay in the trace and not on the answer, we shipped the cost of RAG without the thing people screenshot when they justify the expense.

### 4.7 How the winners convert in the first session

Cross-source, 2026 onboarding research (NN/g articulation barrier; UX Matters on code editors vs chatbots; Zylos on agent empty states; Perspective AI's activation benchmarks) agrees on a short list:

1. **Do not open on a blank prompt.** The prompt asks the user to recall what the product can do before they have seen it. Recognition, not recall.
2. **Value in session 1**, not a tour. Conversational intake ("what are you trying to do") then a pre-scoped task beats Pendo checklists. Reported lifts are large; treat the exact multipliers as vendor-flavoured, the direction as solid.
3. **Artifact over explanation.** Code editors onboard because the user already has a file. Chatbots onboard worse because the user must invent the work.
4. **Kill the empty state that only apologises.** NN/g: say what belongs here, how to make it appear, and give a starting action. AI products that show a worked example and a starting verb retain; products that show a cursor do not.
5. **OAuth is a cliff.** Each connector step loses people. Ask for Google after a win, not before the first message — unless the job *is* the calendar.
6. **One poor first output destroys trust** more than a missing feature. Scope the first task small.

Cursor, Claude, and ChatGPT all now lead with suggested jobs, not an empty composer. Granola leads with "the meeting you are already in." alfred_ leads with "connect Gmail." Superhuman leads with a human onboarding call because the product is a skill. We should lead like Granola/ChatGPT (start inside work you already have), not like Superhuman (learn our UI).

### 4.8 Price psychology that will hit us

- **$20 is the "AI I already understand" slot.** ChatGPT, Claude, Perplexity. We are £18 on Plus — same mental bucket, different promise. If we behave like a worse ChatGPT, we lose. If we behave like "ChatGPT that can act on my calendar and keep the meeting", £18 is cheap against alfred_ at $30 plus ChatGPT at $20.
- **Free must demonstrate the paid thing.** Fathom's free plan is why they get to charge later. Granola's 25-lifetime-meetings free feels like a trial and is reviewed as one. Our Free (30 voice minutes, 50 watcher runs) can demonstrate, if the UI lets someone *use* a watcher. Today it cannot.
- **Metering that punishes ordinary use is hated.** Token caps on Claude are the number-one Pro complaint even among fans. We already chose not to meter turns. Keep that. Surface remaining *expensive* units (voice, video, insights) the way Usage already does — remaining-first, warn at 80%.
- **Annual is a retention trick people resent when refunds are stingy** (Perplexity). Offer monthly first. Annual later as a discount, not the default in v3.5.
- **Team price needs a team noun.** Landing says Custom/SSO; meter says £32/seat and sharing. Sharing is the actual Team wedge (Fireflies/Otter make this obvious). SSO can wait for a later conversation. Do not 404 the CTA.

---

## 5. Why AllTheWay would be worth paying for — work and life

This section is the product argument v3.5 must make *on screen*, not in a manifesto.

### 5.1 The jobs, stated as a person would

**Work**

1. **Leave a meeting with a decision record, not a recording.** Who promised what. Nothing sent until I say so. (Granola's job, plus our confirm gate.)
2. **Don't drop the ball when I'm not looking.** Watch this inbox / this folder / this date, draft the follow-up, stop at the ceiling. (alfred_/Lindy's job, plus our screening.)
3. **Work on the actual document.** This contract, this deck, this screenshot — with a citation I can open. (Claude's document job + Perplexity's citation job.)
4. **Make the thing, then remember how I like it.** Wireframe, summary, checklist, versioned, labelled generated. (Artifacts + brand memory.)
5. **Speak when my hands are busy**, in the language I slipped into, without picking a language. (ChatGPT voice, with a gap they don't cover: 97-language auto-switch as a first-class claim — Igbo still missing, stay honest.)

**Life**

6. **Read this thing I don't want to read.** Tenancy, insurance, mortgage offer, school policy, medical leaflet. Quiz me until it sticks. (The brief's own example. The only honest non-work wedge that is not "be my friend".)
7. **Tell me what needs me this morning**, in thirty seconds, on a phone. Watchers that ran, a meeting that produced commitments, a document that finished indexing. (Digest. Currently quiet and unlinkable.)
8. **Keep work and home from contaminating each other** without two products. Same companion, visible memory I can revert, no silent training on my transcripts.

A person will not pay for all eight on day one. They will pay for **one job that repeats weekly**, then stay for the rest. v3.5 picks three activation jobs and makes them unmissable. The others remain in the product, reachable, not on the home screen.

### 5.2 The three activation jobs (v3.5)

Chosen because they are implemented enough to finish, differentiated from ChatGPT, and true for both a founder and someone sorting a personal admin pile.

| # | Job | First win | Repeat reason to pay |
|---|---|---|---|
| A | **Talk it through** | First conversation becomes a named session with a plan you can reopen tomorrow | Flow-state: not hitting a wall; memory that survives the thread |
| B | **Bring the thing** | Upload or photograph one document → one grounded answer with a citation | The next PDF (work or life) is faster because the last one taught it |
| C | **Don't lose the meeting** | After the next Meet (or a paste/upload of notes), a commitment list to confirm | Every call starts paying for the subscription |

Watchers are the fourth job and the Plus reason, but they are a **second-session** job: you need to have seen a plan before you trust something to run unattended. Connecting Google is the **fuel** for C and for watchers, asked after A or B, not as a wall.

### 5.3 What we uniquely own (keep these visible; they are why £18 is not a worse GPT)

1. **Confirm before it leaves the building** — not a toast, a gate. Competitors added "draft, don't send" as a principle; we have it as a control.
2. **Memory you can inspect and revert** — ChatGPT memory is a rumour in settings. Ours is a ledger with evidence.
3. **No silent meeting participant** — sell it. Granola's entire brand is this. We have the more honest API story (we often only read afterwards).
4. **Screening you can see** — a blocked document that says "this tries to give instructions" is a product moment, not an error.
5. **One companion across languages without a picker** — with the Igbo gap named, not hidden.

If the v3.5 UI hides these in order to look more like ChatGPT, we compete on model quality we do not own.

### 5.4 What we will not claim

- That we are an email client (Superhuman).
- That we reschedule your day (Motion).
- That we speak in the meeting (we cannot).
- That we replace ChatGPT for generic Q&A. We should lose that comparison on purpose and win "did the thing in my accounts, then showed me why."

---

## 6. UX diagnosis: why the current shell fights the jobs

### 6.1 Information architecture is a catalogue, not a path

Primary nav (`nav.ts`): Home, Sessions, Watchers, Agents, Profile.

That is an internal system's sitemap. A new user has to know that **documents are a profile setting**, **the canvas is a tab on a side panel**, **meetings are below transcripts**, and **Agents is where capability is explained**. Five items, twelve products.

Profile as a junk drawer is the loudest IA failure. It mixes identity (memory, language) with work objects (documents, meetings, shares) with admin (usage, connections). In enterprise terms this is one view for four roles. In consumer terms it is the screen nobody opens until they are already lost.

Agents as a primary tab is governance theatre on the consumer path. Specialists should be *how you start work*, not a signed-card gallery. The gallery belongs one click behind "How this is allowed to act."

### 6.2 The companion is beside the work — but the work column is empty features

v3's canvas insight is right: conversation and object side by side. The implementation kept the third column and filled the *main* column with lists that, for a new user, contain nothing. So the layout is "empty dashboard + hidden product in a sheet."

On mobile this is inverted again: the tab bar is the catalogue; the companion is a FAB. The commute user (manifest 07:40) should open **Today + talk**, not five destinations.

### 6.3 Empty states are uneven

Good: documents (what to drop), canvas ("anything it drafts lands here"), profile preferences, sessions (copy is good; button is dead), digest quiet state.

Bad: watchers (no empty), home (fills the void with fake trace), recents (fake data is worse than empty), search (implies a capability).

### 6.4 Two composers, two confirm UIs, no recovery

Companion and session detail both chat. Confirm is rich on session detail and chip-only in the companion. `Recovery` was built to v3 spec and never mounted. Failures still "show a message and stop" in the companion — the pattern the v3 plan named as the most commonly missing.

### 6.5 Visual craft vs product craft

The visual system is ahead of the interaction system: tokens, glass tab bar, motion that respects reduced-motion, auth pages, landing atmosphere. That is an asset. v3.5 should not restyle the brand. It should stop spending the user's first attention on chrome that does not act.

Do not add more ambient, more specialists, more marketing pillars. Remove dead controls or make them true.

### 6.6 Copy and terminology drift

Need one glossary (see §11). Today: companion / agent / specialist / watcher / session / plan / canvas / artifact / trace / cognitive profile. A user cannot hold that list. ChatGPT has chats. Granola has notes. Superhuman has inbox.

v3.5 recommended public nouns (internal names can stay):

| Internal | User-facing |
|---|---|
| Companion / orchestrator | **AllTheWay** or "your companion" — one, not both in the same sentence |
| Session | **Thread** or **piece of work** — pick one; this doc uses **work** |
| Artifact / canvas | **Work** (the object) |
| Watcher | **Watcher** (distinctive; keep) |
| Cognitive profile | **What it has learned** |
| Transparent trace | **Why it did that** |
| Agents / registry | **What's running** (secondary) |
| Specialists | Start verbs: *Read a document*, *Note a meeting*, *Design something*, *Find out* |

---

## 7. Design principles for v3.5

Inherited from v3 R1–R7, plus delivery rules from this review.

**P1 — Every control either does its job or is absent.** No decorative search, bell, New, recents, or traces. A kbd hint is a promise.

**P2 — Sessions are a consequence of talking, never a prerequisite.** First output of a turn (text or voice) upserts `users/{uid}/sessions/{id}` with `updatedAt` and a title from the user's first utterance (truncated, editable later). This is the plan's own instruction in §16.5; v3.5 actually does it.

**P3 — One primary verb per screen.** Home: continue or start. Work: talk to the object. Watchers: create or pause. Account: manage.

**P4 — Capture and approve on mobile; compose and correct on desktop.** Unchanged. Home and companion must be excellent on a phone. Canvas edit can say "open on a larger screen" rather than fake a 40-page editor.

**P5 — First win before OAuth.** Google connect is offered after a document or a conversation exists, except when the user chose "meetings" as their job.

**P6 — Remaining, not consumed. Cost before spend.** Unchanged. Upgrade is a sentence on the meter, not a separate surprise.

**P7 — Propose, don't rearrange.** Watchers and meeting commitments stay behind confirm. Never auto-send. This is how we avoid becoming Motion.

**P8 — Don't regress the gates.** Clarify and confirm stay visible and distinct from "done." Recovery mounts on every failed turn.

**P9 — Marketing numbers are meter numbers.** One table, one currency.

**P10 — Progressive disclosure of power.** Governance, signed cards, ceilings, screening detail: one tap from the thing they describe, not a primary tab.

---

## 8. The product as it should feel

### 8.1 North star (unchanged brand, changed first screen)

You open AllTheWay the way you open Messages: **something to say, or something that needs you.** Not a dashboard of modules.

If nothing needs you, the screen is still useful: three starting jobs, a mic, a composer that accepts a file. If something needs you, it is at the top, linking to the work, not to a list.

### 8.2 Information architecture

**Primary (tab bar + sidebar) — four, not five**

| Item | Route | Job |
|---|---|---|
| **Today** | `/app` | Digest, things that need you, start a job |
| **Work** | `/app/work` | Threads + the object (canvas) + conversation. Replaces Sessions as the noun |
| **Watchers** | `/app/watchers` | Standing instructions. Create is first-class |
| **You** | `/app/you` | Learned memory, language, usage, plan & billing, connections, sign out |

**Secondary (from You, or from context)**

- Documents (library) — also reachable from Work via "bring a file"
- Meetings
- Shared with me
- What's running (registry + specialists as start verbs)
- Voice transcripts / keep-or-forget

**Remove from primary:** Agents. **Remove as a user noun:** Profile, Cognitive Profile, Canvas-as-a-separate-app.

Desktop shell stays **sidebar | work | companion**, but the main column on Today is the digest + starter, and on Work it *is* the object (or the thread list). The companion is not a third product; it is the voice of the current work. On Today, the companion is the default conversation (the existing `companion` thread), promoted so a phone user is in it without hunting a FAB.

**Recents** in the sidebar: last 5 `sessions` from the API, or the heading is omitted. Never placeholders.

### 8.3 First-run (after signup, before Home fills with fake confidence)

A single full-screen step, skippable, stored on the user:

**"What should we start with?"**

1. Talk something through (opens composer + mic)
2. Read a file or photo (opens sheet: camera / files)
3. Catch me up after meetings (explains listen vs transcript, then Google Calendar/Meet connect)

No role, company size, or "how did you hear about us." Optional second line: "Work, personal, or both?" — used only to order examples, not to partition data. Data stays one user scope (FR-D4).

Language offer stays, but *after* the first win or on You, not as a blocker. A commute user who picked Yoruba in voice already has language; don't quiz them in English chrome first.

### 8.4 Today (Home)

Remove the fake TRACE block until there is a real trace from this user. Then show the last 3 lines from the last turn, linked.

Keep: greeting, digest (decisions first), language offer if unset, voice.

Add:

- **Starter chips** when digest is quiet: the three jobs, plus "Continue" if a work item exists
- Digest decision links to `/app/work/:id`, not `/app/sessions`
- If a document is indexing, a single status row (so 09:15 is glanceable)

Mic stays by the greeting. On mobile, the composer from the companion is *on the page*, not only in a sheet — the sheet remains for when they navigate to Work or Watchers.

### 8.5 Work (Sessions + Canvas + conversation)

One place. List of work items (today's sessions, auto-created). Opening one shows plan + object + composer.

**Creating work:** there is still a New control, and it means "new conversation," which immediately creates a session on first send (P2). Empty state CTA is the same handler.

**Canvas** defaults to open when the session has an artifact; otherwise conversation is full-width and a "Show work" control appears when the first artifact is produced (don't make them discover a tab named Work inside a panel named companion).

**Confirm UI** is the session-detail version, shared as a component, used in the companion too (not a new turn). Recovery mounted. Yes runs the one wired effector (§2.5) or says, specifically, that this kind of action is not available yet — never "connectors arrive in the next phase."

### 8.6 Watchers

Empty state: one sentence ("It watches something and stops before anything irreversible") and **Create a watcher**.

Create is a short flow, not a YAML editor:

1. In your words: "When X, draft Y"
2. Companion proposes trigger, action, ceiling
3. Confirm gate
4. `POST /watchers` (new; does not exist today)

Until that API exists, do not show Watchers as a primary tab that cannot create. Either ship create in the same cut or keep Watchers under You as "coming once you've had a conversation." **Recommendation: ship create in v3.5.** Pause without create is a museum. Do not offer "when new mail arrives" until Gmail read exists.

List keeps ceiling labels and pause. Add last run → the work item it produced.

### 8.7 You (Account)

Sections, in this order:

1. Plan & usage (meters + **Upgrade** / **Manage billing**)
2. What it has learned (preferences + visual + revert)
3. Language & voice (locale, keep transcripts)
4. Connected accounts
5. Documents & meetings (or links into those libraries if they grew)
6. What's running (registry, collapsed)
7. Sign out, export, delete account

Mobile sign-out lives here *and* in an account menu on the small header (use `AccountMenu` on the glass header; delete the inert Avatar and the inert Bell, or make Bell open Today’s decisions).

Meetings switch **loads** its saved value.

### 8.8 Landing and pricing

- Hero support line names the three jobs, not the architecture.
- "See how it works" must scroll to a real product moment (voice *or* a document citation), not a decorative `#voice` if that id is weak.
- Pricing: four tiers from the meter, £, Max visible, Team is a price not "Custom", CTA is signup or checkout, **contact is a real page or a mailto**.
- Free feature list must match Free allowances. Watchers are on Free; say how many.
- Plus is the highlighted plan. "Start free" remains the hero CTA (freemium, no card). Plus button is "Upgrade" in-app, "Start free" on the page — do not advertise a free trial unless Stripe trials are actually configured.

### 8.9 Motion, glass, density

Keep the current visual language. App chrome: 1–2 motion beats (tab pill already exists). Do not add onboarding tours, confetti, or a second illustration system. Empty states use one icon size from the existing Lucide set.

---

## 9. Surface-by-surface interaction spec

### 9.1 Click map (required outcomes)

| Control | v3.5 behaviour |
|---|---|
| New | Creates local draft work; first message persists session |
| Search | v3.5: remove kbd hint and placeholder claim **or** implement client filter of sessions/watchers/documents. Prefer implement a simple in-memory filter; full search can wait |
| Bell | Remove, or badge count from digest.awaitingDecision linking to Today |
| Recents | API or omit |
| Specialist row | Starts work with that job's starter prompt + relevant panel (documents / meetings / canvas) |
| Digest row | Opens that work item |
| Usage near limit | "Upgrade to Plus" → Checkout |
| Usage spent | Same, plus what is paused (e.g. voice) |
| Meetings enable | GET then POST; optimistic with rollback (watchers already do this) |
| Composer drop | Upload *and* send a turn "I've added {name} — start with the indemnity / the numbers / whatever is densest" so the user is not told "now ask me" |
| Confirm Yes | Record decision; call connector-gateway for the allowed action (calendar first); write an artifact; same component in companion and session detail |
| Shared artifact | Open in Work/Canvas with `owner` query, the route `Comments` already anticipated |
| Meeting commitment | Mount `CommitmentCard`; confirm goes through the same floor as Yes |
| Auth screens | Wrap in `I18nProvider` (or stop calling `useT` there) so signup cannot throw |
| Failed turn | `Recovery` routes: retry, edit, do it myself, explain |

### 9.2 States every new or changed screen must cover

Loading skeleton matching layout; empty with a verb; error with retry; success specific ("Watcher 'Chase unpaid invoices' is running — it will draft, not send"); validation at the field. Watchers create and Checkout return are the highest-risk.

### 9.3 Accessibility

Account menu keyboard + escape already exists — use it on mobile. Recovery already has `role="alert"` and focus move — mount it. Search, if kept, needs an actual `form` and results. Don't rely on colour for watcher running vs paused (already labelled). Generated media labelled (FR-M1) whenever Phase C images appear; v3.5 must not add unlabelled generation.

### 9.4 What can stay "not yet" without looking broken

- Image generation / Veo (Phase C) — if the UI doesn't offer "make a video" on Free, Max can still be on the pricing page as forthcoming. **Do not sell Max as available if render is not.** If render exists in connector-gateway, expose it behind confirm + cost. If it is only half-wired, hide Max's video lines from the marketing table.
- Live meeting insights meter — hide the row on Free/Plus if allowance is 0, with a one-line "Live checks are on Team" rather than a full bar at 0/0.
- Team sharing — keep share UI; on Free/Plus the API already returns a human message. Surface an upgrade action on that message (Recovery's pattern).

---

## 10. Billing and subscriptions

Deferred 2026-08-26: metering and enforcement are done; the write to `subscriptions/{uid}.tier` is not. v3.5 is the version that sells.

### 10.1 Decisions (so this is not re-litigated in code review)

| Decision | Choice | Why |
|---|---|---|
| Provider | **Stripe** | Default for this stack; Checkout + Portal + Tax + dunning. Open decision 5 closes. |
| Currency | **GBP (£)** | Meter is pence. Landing `$` was drift. Convert marketing, not the meter, unless a later USD price list is a real product decision. |
| Model | **Freemium + flat subscriptions** | Free with no card. Paid is Plus / Team / Max. Allowances stay in `libs/metering`. Stripe does not meter voice minutes. |
| Collection UI | **Stripe-hosted Checkout** | Redirect is acceptable. No Elements, no custom card form, no Metronome, no Billing Meters. |
| After sale | **Customer Portal** | Cancel, card update, plan change. Cancel at period end. |
| Entitlement | **Firestore `subscriptions/{uid}` remains source for `plan_for()`** | Webhooks write `tier`, `status`, `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd`. Connector gateway unchanged. |
| Past due | **Keep paid tier until Stripe marks canceled / unpaid**, then Free | Voice is a live cost; define in code: `active` and `trialing` and `past_due` (during Smart Retries) count as paid; `canceled`, `unpaid` → Free. Log the transition. |
| Annual | **Not in v3.5** | Monthly only. Annual is a pricing experiment after conversion exists. |
| Trials | **None in v3.5** unless Plus conversion is terrible | Free *is* the trial. Landing must not say "free trial." |
| Team | **Per-seat later; v3.5 Team is a single-seat "Plus + sharing + meeting insights"** | True seat packs need org entities we do not have. Don't take £32/seat multiplied by nothing. Price Team as **£32/mo for this account** until org exists, *or* hide Team and sell Plus + Max only. **Recommendation: Plus and Max self-serve; Team is waitlist/mailto until sharing has an org.** Revisit when cowork has more than email-grant. |
| Max | **Only if video generate is a real, confirmed, cost-disclosed path** | Otherwise three tiers. A Max CTA that cannot render is the pricing-page version of a dead New button. |
| Tax | **Stripe Tax threshold monitoring** now; collect when obligated | Digital service, UK company, EU customers. |
| Recovery | **Smart Retries + Stripe emails** | Dashboard, no custom dunning code. |
| Customer mapping | **`metadata.firebaseUid` on Customer and Subscription** | Auth is Firebase; never trust a client-posted uid on the webhook. |

### 10.2 Plan table (v3.5 public, must match `libs/metering`)

If Team is waitlisted, drop it from Checkout but keep the meter row for later. If Max is hidden, same.

Shown here as the *intended* public table once video is real; implementers must hide rows that cannot be bought.

| | Free | Plus £18/mo | Team £32/mo | Max £60/mo |
|---|---|---|---|---|
| Voice | 30 min | 600 min | unmetered | unmetered |
| Watcher runs | 50 | 1000 | unmetered | unmetered |
| Connector calls | 200 | 5000 | unmetered | unmetered |
| Documents | as metered in code (5 vs 200 in manifest — **align code and table in the same PR**) | | | |
| Images | 20 | 500 | 2000 | unmetered |
| Draft video | 0 | 20s | 60s | 300s |
| Final video | 0 | 0 | 10s | 20s |
| Meeting insights | 0 | 0 | 300 | unmetered |
| Sharing | — | — | yes | yes |

**Documents stored** are in the v3 manifest and must either be a real meter or removed from marketing. v3.5 should add the meter *or* stop claiming "5 documents on Free."

### 10.3 Integration shape (gateway)

Keep entitlement checks where they are. Add to the **gateway** (public, already holds secrets pattern):

1. `POST /api/billing/checkout` — authenticated; creates Customer if needed (idempotent on uid); `mode: subscription`; `line_items` from server-side price ids; `client_reference_id` = uid; success `/app/you?billing=ok`, cancel `/app/you?billing=cancelled`.
2. `POST /api/billing/portal` — authenticated; Portal session → redirect.
3. `POST /api/billing/webhook` — raw body, `Stripe-Signature`, **no** Firebase user. Handlers:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed` (log + trace; Smart Retries does the rest)
   - `entitlements.active_entitlement_summary.updated` optional; **do not make Stripe Entitlements the runtime gate** in v3.5 — duplicate of `libs/metering`. Mapping features in Stripe is useful later for experiments; a second source of truth now is how Free becomes Plus during an outage.

Idempotency: store `stripeEventId` processed. Webhook is the only writer of `tier` besides a documented admin script.

Success URL must not grant Plus by query string. The page shows "Updating your plan…" and polls `GET /api/usage` until `tier` changes or 15s, then tells them to refresh. Grant happens only after the webhook.

### 10.4 Product UX for money

- **You → Plan:** current label, price, remaining meters, button **Upgrade** or **Manage plan**.
- **Paywall copy:** specific. "Live meeting checks are on Team" / "Final video is on Max — about £X for this clip" (cost in plan units, R6). Never "this is a premium feature."
- **Failed payment:** banner on Today, not a lockout of reading. Voice and generation stop when the meter says so; existing documents remain.
- **Downgrade:** at period end; remaining days shown from `currentPeriodEnd`.
- **No card on Free.** Usage screen does not nag until 80% of a meter they actually use.

### 10.5 Infra

Stripe secret and webhook secret in Secret Manager, gateway IAM only. `STRIPE_PRICE_PLUS` etc. as env, not client Vite vars. Never ship the secret key to the web app.

Webhook endpoint on the gateway's own hostname (same reason as SSE: Hosting timeouts). Stripe dashboard URL = `https://gateway-…/api/billing/webhook`.

### 10.6 Proof

- Checkout in test mode with `4242` upgrades a Firebase user; usage label switches without a manual Firestore edit.
- Portal cancel → webhook → Free at period end (test clock).
- Replay of the same event does not toggle twice.
- A forged webhook without signature is 400 and does not write.
- `check-plan-table.py` includes marketing fixture or shared JSON export from the Python plans.

---

## 11. Copy, landing, and the glossary

### 11.1 Voice

Calm, specific, adult. Same register as the better empty states already in the app. No "reimagine." No "just." Errors explain the situation and the next step. Confirmations name the object ("Watcher paused. It will not run overnight.").

### 11.2 Landing hero (direction, not final art)

**Headline** can keep the brand line if it stays unique.

**Support:** "Talk it through, bring the document, keep the meeting. It shows the plan before it acts — and you can see what it has learned."

**Primary CTA:** Start free  
**Secondary:** one of: "Read a sample contract with citations" or "See a meeting that wasn't joined by a bot"

### 11.3 In-app first messages

Replace generic "Welcome back… Ask me for something" with a job-aware line after first-run, or with the three chips if they skipped.

### 11.4 Honesty about limits

Igbo: if a user asks, say it is not on the Live list. Don't imply 97 means every African language they care about.

Meetings: "It listens on calls you host, or reads the transcript after. It cannot speak in the room."

---

## 12. What v3.5 will not do

Left for v4 or later, so this version can finish:

- Meet Media API preview hardening and participant enrolment programmes
- Gemma second screener
- EU residency / moving Vertex off `global` for media
- Native apps, desktop app, PSTN, LiveKit
- Live cursors / CRDTs
- Extra connectors (Docs, Gmail send, GitHub, Notion) beyond making Calendar + existing Google connect obvious
- True multi-seat organisations, SSO, audit exports for compliance theatre
- Stripe Metronome, usage overage invoices, annual plans
- A public Agent registry as a consumer home
- Redesigning the visual brand or replacing the confirm gate with "faster" implicit send
- Filling six locale catalogues with unreviewed machine text and calling i18n done

---

## 13. Sequencing

Order is the first hour, then money, then the jobs that make money feel fair.

| Cut | Delivers | Proof |
|---|---|---|
| **0. Honesty** | Remove or wire dead chrome (New, search, bell, recents, fake trace, `/contact` and other footer 404s). Mobile `AccountMenu`. Meetings GET. Mount Recovery. Fix companion comment. Wrap auth/offline in `I18nProvider`. Fix digest field names. Shared-artifact route. | A new account cannot click something that no-ops or crash on `/login`. |
| **1. Work exists** | Session upsert on first turn/voice. Title from utterance. List populates. Digest links to work ids. `POST …/end` when the user leaves work, so memory can learn. | Talk on a fresh account → item on Work tomorrow. |
| **1b. One action** | Confirm Yes → Calendar `invoke` (if connected) **and** plan persisted as an artifact. Voice refused at connect when minutes are spent. | "Yes" puts something on the calendar or says why it didn't. Canvas is no longer empty after a plan. |
| **2. Today** | First-run three jobs. Composer on Home (mobile). Starters. No fake trace. | Session-1 produces a keepable thread or a cited answer. |
| **3. Watchers create** | `POST /watchers` + empty state + confirm. Triggers limited to what can fire. Publisher to `watcher-trigger`. Quota check before a run. | Plus has something to sell besides minutes. An inbox-Gmail watcher is not offered. |
| **4. IA** | Four-item nav. You page. Agents demoted. Documents/meetings linked from Work and You. Specialist starts a job. | Profile is no longer the product. |
| **5. Billing** | Stripe Checkout + Portal + webhooks + plan table unification + upgrade on meters. | Money in test mode changes `tier`. |
| **6. Meetings as a job** | Load switch. Path from first-run job 3. Commitments confirm (mounted). Bot-free copy on empty state. | After one call, a decision list exists. |
| **7. Composer drop** | Upload + auto-turn. Citations on the answer, not only in trace. | Job B is one gesture. |

Cuts 0–1b are not optional polish; they are the difference between "it talks" and "it did something I can keep." Billing (5) can parallel 3–4 once 1 is true — do not charge before a session persists, and do not charge for confirm-that-does-nothing.

Estimate: smaller than a v3 phase A–G, but only if we refuse new pillars. Honesty + session persistence is days if focused; one Calendar action + IA + watchers create + Stripe is the rest of the version.

---

## 14. Success metrics (v3.5)

Defined before decorating.

| Metric | Target (direction) | Why |
|---|---|---|
| Fresh account → persisted work item in session 1 | Majority of testers who send anything | P2 |
| Dead-click rate on primary chrome | Zero on New, Recents, Search-as-claimed, Bell-as-claimed | P1 |
| Time to first confirmed **action that ran** (or a truthful refusal) | Within first session for job A or C | Gate plus effector |
| Checkout completion (test, then live) | Measured | Funnel exists |
| Plus conversion among users who hit 80% voice or created a watcher | Measured | Those are the paid jobs |
| 7-day return | Opened Today or Work without being poked | Digest has to be real (including the field-name bug) |
| Support/review theme | Not "nothing happened" / "button did nothing" | Perception |

Do not set a Meet Tier-2 join-success target (v3 plan already refused this).

---

## 15. Open questions for the owner (few, real)

1. **Team in v3.5:** waitlist vs £32 for a single account with sharing. Recommendation: waitlist until orgs exist.
2. **Max in v3.5:** only if Veo is a confirmed user path. Recommendation: hide from Checkout until that path is the same quality as voice.
3. **Documents cap:** add a meter or remove from copy. Recommendation: add, so Free cannot become a corpus dump.
4. **Search:** implement shallow filter vs remove. Recommendation: shallow filter on Work, not global omniscience.
5. **Currency:** confirm GBP everywhere. If USD is required for hackathon optics, dual-display is a marketing problem; the meter stays pence.
6. **First effector:** Calendar create vs also Gmail send (send is implemented; read is not). Recommendation: Calendar only in v3.5, so confirm is real without CASA.

Payment provider is no longer an open product question; Stripe is the answer. Remaining work is implementation against §10.

---

## 16. How to read this against v3

v3 remains the capability bible (artifacts, RAG, meetings, specialists, flags, isolation). v3.5 does not reopen those designs. It says: **several of those capabilities are in the tree and not in the user's week.** The enhancement is to put them in the week, charge for the expensive week, and stop pretending unused chrome is a product.

If a later agent implements "more multimodal" before Cuts 0–1b, they are building v4 on a storefront that still cannot create a session or keep a promise after Yes. Don't.

---

## Sources

**Code (primary).** `web/src/app/{nav.ts,AppLayout.tsx,AppTopBar.tsx,Sidebar.tsx,AccountMenu.tsx,CompanionPanel.tsx,screens/Home.tsx,screens/Sessions.tsx,screens/SessionDetail.tsx,screens/Watchers.tsx,screens/Profile.tsx,screens/Agents.tsx,Digest.tsx,Documents.tsx,Meetings.tsx,Usage.tsx,Canvas.tsx,CanvasPane.tsx,Share.tsx,SharedWithMe.tsx,Comments.tsx,Recovery.tsx,Specialists.tsx,data.ts,use-turn.ts,i18n.tsx}`; `web/src/routes/{landing.tsx,auth/*,offline.tsx}`; `web/src/components/blocks/{pricing.tsx,site-footer.tsx}`; `web/src/App.tsx`; `web/src/lib/stream.ts`; `services/gateway/src/{index.ts,repos/sessions.ts,repos/watchers.ts,repos/digest.ts,seed.ts,voice/relay.ts}`; `services/orchestrator`; `services/connector-gateway`; `services/watcher-runtime`; `libs/metering/src/alltheway_metering/__init__.py`; `docs/AllTheWay-v3-Implementation-Plan.md` §16.5; `docs/AllTheWay-A2A-and-Platform-Plan.md` Phase 8.

**Category and purchase behaviour.** ChatGPT vs Claude subscription reviews (Tom's Guide; Honest AI Guide; AgentPlix; Medium Claude Pro 2026); Canvas vs Artifacts (AI Smart Ventures); Granola / Otter / Fireflies / Fathom comparisons (Stackbuilt, MeetingNotes, Fireflies blog, The AI Gear, AI Alleyway); alfred_ and Lindy assistant roundups and the Rhumbix case (treat ROI numbers as vendor-reported); Superhuman 2026 reviews (CMDK, The Sunrise Digest, TheAISelect); Motion vs Reclaim (Canopy Press, Morgen); Yukih cancellation essay (Medium, Jun 2026); Perplexity Pro reviews (G2/Coursiv); NN/g articulation barrier via UX Matters (Jul 2026); Zylos agent onboarding (Mar 2026); Perspective AI activation reports (directional only).

**Billing.** [Stripe Checkout subscriptions](https://docs.stripe.com/billing/subscriptions/build-subscriptions); [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal); [Entitlements](https://docs.stripe.com/billing/entitlements) (optional, not the runtime gate); [Smart Retries](https://docs.stripe.com/billing/revenue-recovery); [Stripe Tax monitoring](https://docs.stripe.com/tax/monitoring). Metronome / Billing Meters rejected for this version because allowances are already enforced in-process.

---

*v3.5 is successful when a person who has never seen the repo can, in one sitting, start a piece of work that is still there the next morning, understand why a limit exists, and pay without talking to us — without us having built a louder, less trustworthy agent.*
