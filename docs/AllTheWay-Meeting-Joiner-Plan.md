# Meeting joiner — sidebar (A) + guest notetaker until Meet Media (C)

**Status:** Accepted direction (2026-08-31)  
**Audience:** Product owner + whoever ships the next meeting increment  
**Normative decision:** [ADR 0007](decisions/0007-guest-notetaker-until-meet-media.md)  
**Reversibility:** Phase 0–2 are two-way doors. Speaker-name promises, a visible bot, and store-listing caption scraping are one-way (trust). Meet Media enrolment is a one-way *unlock* — when it works, the Meet bot is retired, not kept as a second Meet path.

Research cut-off: **2026-08-31**. Sources are listed at the end. Claims are labelled **V** (verified in this tree or a cited public doc), **I** (inferred from mechanism), **A** (assumed until reproduced).

---

## Summary

The screenshot that prompted this is **WalkCroach**, not the meeting joiner. AllTheWay already has a separate Chrome extension (`extension/`) that captures **tab audio**, transcribes it, and can push **live insights** into a side panel. It is real, but it is a thin recorder with a glance box — not a meeting companion.

**Recommendation (both A and C):**

1. **A is the product.** Deepen **AllTheWay meeting notes** into a persistent sidebar: full transcript, Get insights, commitments to confirm, a **ladder of speaker attribution** that never guesses names. WalkCroach stays a page companion.
2. **C is a capture rung, not a second product.** Until this Cloud project is enrolled in Meet Media (and the restricted-scope / CASA gate after that), we will offer an **opt-in, labelled, mute, never-speaking guest notetaker** that the host must admit. Same scribe, same insights, same confirm gate. Default capture remains the extension (nothing extra in the roster). The bot exists because Meet Media cannot be used by a mixed room today.

**What this supersedes.** On 2026-08-31 this document (and the v3.5 / PRD “won’t”) said we would not join as a guest. That is withdrawn for a **time-boxed stopgap**. The reason it lost originally still holds commercially (Granola sells the *absence* of a bot; Fathom’s default bot is the most-cited complaint). So the bot is **never the default**, never auto-joins the calendar, and is retired on Meet the day `connectTier2` actually completes.

**Dominant trade-off:** we pay the 2026 “bot tax” (waiting-room flag, host admit, a name in the list) in exchange for (a) live notes when the user is not in a Chrome tab, (b) Zoom/Teams desktop, (c) **per-participant audio → real speaker labels**, which mixed `tabCapture` cannot do. We give up the clean “nothing in the participant list” promise *on meetings where they explicitly send the bot*. We do **not** give up FR-C4: it still cannot speak.

---

## Assumptions (architected against)

- Confirm-before-act stays. Commitments stay proposals (FR-C2). Sending a bot into a call is itself a confirmable act.
- The agent still cannot speak (FR-C4). The bot is camera-off, mic-muted, no TTS into the room. One optional chat line is disclosure, not conversation.
- Team of one, Cloud Run + Vertex already in production. Do not build a Playwright Meet joiner.
- Meet Media remains the *preferred* live Meet path; C exists because enrolment + every-participant-in-preview + restricted OAuth is not something we control.
- “Get insights” means an explicit CTA in the sidebar, not a second product.

---

## Quality attributes (ranked)

1. **Trust** — cannot speak; disclosure is real; never invent a speaker name; bot is labelled and admitted, never sneaked.  
2. **During-meeting usefulness** — a transcript you can scroll, insights you asked for, on Meet *and* on Zoom/Teams when they are not in Chrome.  
3. **Honest labels** — Unattributed beats a wrong name; platform names beat Speaker 2.  
4. **Capture reliability** — 90 minutes without silent stop; lobby timeout is a recorded miss, not a hang.  
5. **Store review / privacy** — `tabCapture` is still the most scrutinised Chrome permission; a bot does not put `tabCapture` on WalkCroach.  
6. **Cost** — insight passes stay metered (FR-C6); bot-hours are a new meter, not a silent Vertex bill.  
7. **Time-to-Media** — every bot integration should be throw-away on Meet the day Media connects (same sink, same meeting id).

---

## What it can do today

Verified in `extension/`, `services/gateway/src/meetings/`, `services/scribe/`.

### Four rungs (FR-C5, as built — bot not shipped)

| Tier | What | Status |
|---|---|---|
| **2** Meet Media API (live, receive-only, exactly 3 audio transceivers) | Not enrolled. `connectTier2` throws a recorded refusal. | Code exists to fail honestly. **V** `services/scribe/src/meet.ts` |
| **2.5** Guest notetaker (this plan) | Visible mute participant, host-admitted | **Contract in tree. Vendor unsigned — `vendor_pending`.** |
| **1** Meet REST transcript after the call | Host’s Google credential; entries can carry a **participant resource name**, not a display name. | Reachable if transcription was on. |
| **1.5** Extension `chrome.tabCapture` | Audio of the tab you are already in. Nothing joins. | This is the live path we actually have. |

### The extension, specifically

1. You must have **AllTheWay open and signed in** (content script on the product origin hands over a one-hour Firebase ID token + gateway origin).  
2. On the **meeting tab**, tick “I have told everyone”, press **Start taking notes**.  
3. `tabCapture` mints a stream id; an **offscreen document** holds the MediaStream (an MV3 service worker cannot). Audio is played back to the speakers first so the call is not silent.  
4. 16 kHz PCM goes to `wss://…/api/meetings/capture`. Gateway authenticates, opens `gemini-3.5-transcribe-live-preview` with **no tools, VAD off, TEXT only** (FR-C4 by configuration).  
5. Finished-looking text is stored on the scribe (batched every 15s). Insights run on a backing-off schedule (1 / 3 / 5 / 10 / 15 min, then every 15) **and** on **Check now**.  
6. A side panel opens: last ~200 characters of “Hearing”, insight cards, **Check now**. Phone/web `MeetingInsights` polls the same store so screen-share does not leak the panel to the room.

It **cannot** speak, join the roster, capture Zoom/Teams **desktop** apps, or name speakers on the live mix.

---

## Identity confusion (the screenshot)

**Verified.** The sidebar titled WalkCroach with “Summarize this page / Draft reply / Save” and “Allow on alltheway.rinegansolutions.com” is the **WalkCroach** page companion. The meeting joiner is **AllTheWay meeting notes** (`extension/manifest.json` name). They share neither code nor permissions model. Treating WalkCroach as the meeting product would add `tabCapture` to a page-reader and fail Chrome Web Store purpose rules. The guest bot is a **server-side join**, not an extension permission — it does not belong on WalkCroach either.

---

## Why Meet Media is not available (and will not be “next week”)

This is why C is in scope.

### Preview enrolment is still the gate

Meet Media is listed in the [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) as of this research cut. Official get-started text (**V**):

> To use the Meet Media API to access real-time media from a conference, the Google Cloud project, OAuth principal, **and all participants in the conference** must be enrolled in the Developer Preview Program.

That last clause is why Media cannot replace a guest bot for a supplier call, a client review, or anyone who is not in *our* preview cohort. Recall’s own Meet Media “Direct Connect” docs repeat the same limitation.

### The offer shape is rigid (already recorded in `meet.ts`)

Official concepts guide (**V** [Meet Media concepts](https://developers.google.com/workspace/meet/media-api/guides/concepts)):

- Exactly **three** receive-only audio media descriptions.
- One to three receive-only video (we should request **zero video** until we have a reason; FR-C is notes, not a second camera).
- Ordered data channels `session-control` and `media-stats`.
- Codecs: AV1 / VP9 / VP8; libwebrtc no more than 12 months behind Chromium STABLE; **≥ 4 Mbps** per connection.
- Refused for: underage accounts, client-side encrypted meetings, watermarked meetings, third-party hardware (Cisco-style Meet rooms).

`connectTier2` already throws a recorded refusal. Do not write unverifiable SDP until enrolment is real. When it is, **buy a WebRTC client that already speaks this offer** (Recall Direct Connect, or a maintained libwebrtc sidecar) rather than owning the codec treadmill as a team of one.

### Restricted OAuth is a second gate after preview

All Meet Media scopes are **Restricted** (**V** [get started](https://developers.google.com/workspace/meet/media-api/guides/get-started)):

- `meetings.conference.media.readonly`
- `meetings.conference.media.audio.readonly` (prefer this — audio only)
- `meetings.conference.media.video.readonly`

Restricted scopes require Google OAuth verification **and** a Cloud Application Security Assessment (CASA) if conference media is stored or transmitted via our servers — which it would be. Annual recertification. This is the same class of gate that kept Gmail read out of v3.5. Enrolment in the preview is necessary and **not sufficient**.

### What Media gives that a bot does not

- No extra participant (the 2026 commercial asset, recovered).
- Google’s own initiation dialog for every participant (FR-C3 visibility, done by Google).
- Receive-only by construction (FR-C4 structural, not a mute button).
- Participant metadata from Meet, not from scraping a DOM.

Until those three enrolment facts are true for *this* project **and* for people in the room, Media is a recorded miss, not a plan.

---

## Why a guest bot is now allowed (and still dangerous)

### What changed in the industry (2026)

Platforms did not ban notetakers. They made **unattended** join expensive.

| Platform | What 2026 actually does | Consequence for us |
|---|---|---|
| **Google Meet** | [Safeguarded guest admit](https://workspaceupdates.googleblog.com/2026/02/safeguarded-guest-admit-flow-in-google-meet.html) (Rapid 24 Mar 2026, Scheduled 7 Apr 2026): two knock queues; the second is high-scrutiny with **default deny**. Vendors report a **“potential risks”** label on bots and a **~5 minute** waiting-room timeout. | The bot must knock. A host (ideally ours) admits it. If the call starts late, the bot has already left — that is a product state, not a silent miss. |
| **Microsoft Teams** | Admin policy `ExternalBotAccessMode` (default `RequireApprovalWhenDetected`): detected external bots go to lobby regardless of lobby settings; extra confirm before admit. `BlockDetectedBots` exists. Certified **compliance recording** is a different Graph path — we are not that. | Same pattern: labelled, lobby, host admit. Tenant admins can block us entirely — fall back to extension / after-call, say so. |
| **Zoom** | From **2 Mar 2026**, Meeting SDK apps joining **external** meetings need user attribution: **OBF** or **ZAK**, or use **RTMS** (no extra participant). OBF requires the authorising user **already in the meeting**; if they leave, the bot is disconnected. | A nameless SDK bot is no longer a legal design. Either we join *as their assistant* (they are present) or we use RTMS (Zoom’s analogue of Meet Media — also an enrolment/marketplace path). |

Google also shipped **explicit participant consent** for Gemini notes / recordings / transcripts (admin-off by default, rollout from 5 May 2026). That does not bind a third-party bot, but it is the expectation of the room: people have been trained to *see* a consent dialog. Our bot must be at least as obvious.

### What we will never do

- Join without a per-meeting opt-in (calendar “record everything” is a later, gated, confirmable Watcher — not v1 of C).
- Join with a human-looking name or stolen avatar.
- Speak, share a screen, or answer questions in chat beyond one disclosure line.
- Put the bot on WalkCroach or in the Chrome extension.
- Bypass waiting rooms, CAPTCHAs, or “potential risks” queues.
- Build a headless Chrome / Playwright joiner. That is now an arms race against Google’s risk queue and Teams bot detection. A team of one will lose it every quarter.

### Build vs buy (C)

| Option | Verdict |
|---|---|
| **Buy a meeting-bot BaaS** (Recall.ai first; Meeting BaaS if we need on-prem / EU-only and can accept mixed-stream quality) | **Chosen.** Join reliability, 2026 lobby behaviour, separate audio streams (Meet/Zoom/Teams, up to 16 loudest), and Recall already has **Meet Media Direct Connect** so the vendor dies on Meet when we enrol. List prices observed Aug 2026: Recall ~$0.50/h recording + $0.15/h their transcribe (or BYO). Prefer **BYO Vertex** so FR-C1 screening and FR-C4 TEXT-only stay ours. Recall advertises US/EU/JP residency — **pin EU**. |
| **Meeting BaaS self-host** | Fallback if a customer cannot send media to a US vendor. Mixed/screen-record architecture; weaker diarization. |
| **Own Playwright/Puppeteer Meet client** | Rejected. 2026 detection + codec/layout churn. |
| **Zoom RTMS / Teams Graph compliance recording** | Not C. Those are *platform-native* listen paths (cousins of Meet Media). Revisit as Zoom/Teams “Tier 2”, not as the stopgap. |
| **Desktop Recording SDK (no visible bot)** | That is Granola / Fathom bot-free: overlaps our **extension**. Do not buy a second tab-capture. |

**I:** a first Meet-only bot slice is on the order of a week if the BaaS is used as a dumb media pipe into the existing capture sink; owning join is months.

---

## Phase 0 — errors to fix before extending

Epistemic status: **V** = verified in this tree; **I** = inferred from mechanism; **A** = assumed until reproduced.

| ID | Severity | Status | Defect |
|---|---|---|---|
| P0-1 | Trust | **V** | Gateway `capture.ts` comments say disclosure is **enforced on the socket**. The auth frame is `{ token, meetingId, title }` only (`offscreen.js`). A crafted client can record without the checkbox. Popup/background check is UX, not the boundary. |
| P0-2 | Reliability | **V** | ID token is one hour (`getIdToken(false)`). Cap is **90 minutes**. No refresh. A long meeting dies mid-call. |
| P0-3 | Reliability | **V** | `capturing` lives in a service-worker variable. Chrome kills the worker; popup/badge and offscreen disagree. |
| P0-4 | Correctness | **V** | Live transcriber emits every `inputTranscription` as a new utterance. Google documents **interim** vs **final** (`interim_input_transcription` vs `input_transcription`). Voice folds this; meetings do not. Notes can fragment or duplicate. |
| P0-5 | Privacy / review | **V** | README claims `host_permissions` were narrowed to four hosts. `manifest.json` still has `https://*.run.app/*` and `wss://*.run.app/*` — every Cloud Run service. CWS will ask. |
| P0-6 | UX | **V** | Capture uses **active tab**. Clicking the icon while AllTheWay is focused records the product, not Meet. No Meet-tab picker. |
| P0-7 | UX | **V** | Side panel transcript is last **200 characters**, hidden until first fragment. Not a transcript. |
| P0-8 | UX | **V** | **Check now** has no pending, empty, metered-out, or error state. Failures are swallowed (`capture.ts` maybeInsights catch). Looks like a dead button. |
| P0-9 | Reliability | **I** | `chrome.runtime.sendMessage` from offscreen to the panel has no `lastError` handling. If the panel is not open, MV3 reports “Receiving end does not exist”. |
| P0-10 | Cost / product | **V** | Insight allowance missing or spent returns `[]` with no signal. Free/Plus with 0 live insights: Check now does nothing. Copy already exists on web (“Live checks are on Team”) and is not in the panel. |
| P0-11 | Completeness | **V** | Meeting id is `tab-{tabId}-{Date.now()}`. Not a calendar event. After-call Meet transcript cannot merge onto this record without a later link step. |
| P0-12 | Docs drift | **V** | FR-C3 says live listen is **host-only**. Tier 1.5 captures any tab. That is a product decision, not a silent bug — but the requirement and the extension disagree. |

**Phase 0 exit:** disclosure on the auth frame and refused by the gateway; token refresh for the capture socket; capturing state in `chrome.storage.session`; interim/final handling; host_permissions match the README; Check now has states; panel does not throw if closed.

The bot **must not ship** until P0-1 exists on *every* capture path (extension and bot webhook). A BaaS that can start recording because we have an API key and a Meet URL, without a stored `disclosed: true` for that `meetingId`, is the same hole.

---

## Speaker attribution — can we?

**Short answer:** not live, not as real names, from **tab audio**. Yes live **from per-participant bot/Media streams**. Yes afterwards from Meet REST. Yes live **if Meet is already showing named captions**.

| Source | When | What you get | Fit |
|---|---|---|---|
| `gemini-3.5-transcribe-live-preview` | Live | Text. **Diarization not supported** (Google feature table, Aug 2026). | Keep for mixed tab audio only. |
| Mixed `tabCapture` audio | Live | One mix. No per-person streams. | Cannot recover names from the mix. |
| Meet on-page captions | Live, Meet in Chrome | Names Meet already shows. Fragile DOM. | Best live names **without** a bot, if we opt into a Meet content script. |
| Bot **separate audio streams** (Recall: Meet/Zoom/Teams, ≤16) | Live, after host admit | Platform participant id + that person’s PCM. Transcribe each stream → **their display name**, not Speaker 3. | This is the engineering reason C exists. **V** [Recall separate audio](https://docs.recall.ai/docs/how-to-get-separate-audio-per-participant-realtime). |
| Meet Media (Tier 2) | Live, all enrolled | Three receive-only audio transceivers, participant metadata. | Still not enrolled; still the *end state* for Meet. Three streams ≠ twelve people: same mixing problem Media already documented in `notes.ts`. |
| `gemini-3.5-transcribe-preview` batch | After, ≤15 min chunks with diarization on | **Speaker 1…8**, not “Ada”. 3+ speakers experimental. | Relabel after the call when we only had a mix. |
| Meet REST `transcriptEntries.participant` | After, host, transcription on | Resource name; display name is a **second lookup**. | Best real names when they hosted, even if live was Unattributed. |

**Chosen ladder (updated):**

1. Live, tab-capture: **Unattributed** (or Meet caption names if Phase 3a is allowed).  
2. Live, bot or Media: **platform display name** on that stream. Never a model-guessed “Ada said”. If the platform said “Tolulope Orina”, print that. If the stream is mixed (two people on one laptop), label the *device*, not two invented people.  
3. After the call: overlay Meet REST names onto the same `meetingId` when we can join the conference record.  
4. Else batch Speaker 1–N for the user to map.

Rejected: audio clustering to invent names; scraping Meet without saying so in the listing; promising Zoom desktop names from the Chrome extension.

---

## Target: one meeting surface, two capture methods

One Chrome **side panel** (and the same record on phone/web) is the meeting surface:

- **Hearing** — scrollable transcript, utterance rows, speaker column when the rung can fill it.  
- **Insights** — same three kinds as today; **Get insights** as a first-class CTA with pending / nothing / allowance.  
- **Record** — two verbs, not one: **Notes from this tab** (1.5) and **Send AllTheWay into the room** (2.5). Disclosure + host-will-admit on the second.  
- **After** — same meeting record (notes, commitments to confirm, insights history, which rung served it and why).

The popup can shrink to Start / Stop + disclosure; the panel holds the work. The bot never has a separate UI brand.

```
                    ┌─────────────────────────────────┐
                    │  Side panel / Meetings in app   │
                    │  transcript · insights · confirm│
                    └──────────────┬──────────────────┘
                                   │ same meetingId
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
     Tier 2 Media             Tier 2.5 bot            Tier 1.5 tab
     (Meet, enrolled)        (stopgap, opt-in)      (Chrome, default)
           │                       │                       │
           └───────────┬───────────┴───────────┬───────────┘
                       │                         │
                 capture-sink / scribe      Tier 1 REST after
                 Vertex transcribe + screen
```

---

## Phases

### Phase 0 — Make today’s path true

Shipped in tree 2026-08-31 (gateway + extension 0.2.0 + web token mint). Needs a gateway deploy and a web deploy before production meetings see it.

Ship before any new capability. Fitness: a 20-minute Meet tab produces a scribe record whose utterance count matches finals, not interims; a 70-minute capture stays authenticated; gateway rejects `disclosed: false`.

### Phase 1 — Sidebar as the product (A)

Shipped in tree 2026-08-31 with Phase 0 (extension 0.2.0). Reload the unpacked extension.

- Move start/stop + disclosure into the side panel (popup optional).  
- Full transcript list (not 200 chars); pin newest; don’t auto-steal focus.  
- Target the **Meet/Zoom web / Teams web** tab explicitly (query those hosts; refuse if none).  
- Persist capturing `{ tabId, meetingId }` in session storage.  
- “Get insights” = existing `insights-now` with UI states; surface Team-only / allowance.  
- Copy: still “cannot speak”. Do **not** yet promise a bot.

**Trade-off:** more Chrome UI to maintain vs a recorder nobody uses.

### Phase 2 — Insights you can trust in the room

Shipped in tree 2026-08-31 (cite-or-drop enforced on the pass; Check now quiet reasons; phone `MeetingInsights` still polls; presenting hides the panel insights and skips `sidePanel.open`).

- Keep the bar: no summaries, cite or drop (already in `insights.ts`).  
- Show **why** Check now was quiet (too little transcript / screened / metered).  
- Keep phone polling (`MeetingInsights`) — screen-share still leaks the desktop panel.  
- Optional: one “private insights” mode that refuses to open the panel on a sharing tab (detect `display-capture` / Meet presenting — **I**, needs a probe).

### Phase 3 — Speaker column without a bot (A ladder)

Shipped in tree 2026-08-31 (extension 0.3.0). 3b is a recorded refusal (`no_stored_audio`) — we do not store mixed PCM. 3c overlays Meet REST display names onto Unattributed notes; resource paths never render.

### Phase 4 — Guest notetaker, Meet-first (C, stopgap)

Shipped in tree as the **product contract** 2026-08-31 (Max-only `bot_hours`, disclosure on `POST /meetings/bot`, Meet-only, no unmute path). **No vendor is signed.** A start returns `vendor_pending`; the UI says so. Do not fake a knock.

- Keep the bar: no summaries, cite or drop (already in `insights.ts`).  
- Show **why** Check now was quiet (too little transcript / screened / metered).  
- Keep phone polling (`MeetingInsights`) — screen-share still leaks the desktop panel.  
- Optional: one “private insights” mode that refuses to open the panel on a sharing tab (detect `display-capture` / Meet presenting — **I**, needs a probe).

### Phase 3 — Speaker column without a bot (A ladder)

1. **3a Meet captions (optional host permission `https://meet.google.com/*`)** — read Meet’s caption nodes, attach `speaker` when Meet labelled them. Disclose in CWS. Fail closed to Unattributed.  
2. **3b Post-call batch diarize** on stored PCM or re-fetched audio windows (15 min chunks) → Speaker 1–N. UI: map to names.  
3. **3c Host Meet REST** — if we can join this capture to a `conferenceId`, resolve participant resource names to people.

Do not block Phase 1 on 3a. Caption scraping is a one-way listing decision. 3a is what a Granola-like user gets **without** sending a bot.

### Phase 4 — Guest notetaker, Meet-first (C, stopgap)

**Scope:** Google Meet URLs only. Buy BaaS. Mute, labelled, host-admitted.

**Must:**

- Per-meeting opt-in in the sidebar and on the calendar event card: “Send AllTheWay notes into this Meet.” Confirm. Store `disclosed` + who confirmed + when.  
- Display name: `AllTheWay notes` (optionally `· {first name}` so the host recognises it). Never a spoofed human.  
- Camera off, microphone muted. No output audio.  
- On join: one chat line if the platform allows bot chat — “I’m taking notes for {name}. I cannot speak. Remove me if this call should not be recorded.”  
- Waiting-room / high-scrutiny queue: UI state **Knocking** with a 5-minute clock. If ejected, the meeting record says **not admitted**, not “recording failed.” Invite-to-ongoing-call is the recovery (vendors already recommend this when the host is late).  
- Media pipeline: BaaS WebSocket PCM → existing `/api/meetings/capture` (or a sibling that shares `capture-sink`). Same screening, same transcriber, same insight runner.  
- Meter bot-hours. **Max only.** Plus and Team stay on tab capture / after-call.  
- Locale / empty-state copy changes: “No bot unless you send one. It still cannot speak.”

**Must not:** calendar auto-join; Zoom/Teams yet; speaking; storing BaaS’s own LLM notes (we already have insights).

**Fitness:** 10 hosted Meets: knock visible to host, admit → utterances on the same meeting record as a tab-capture would have produced; deny/timeout → `tierReason` recorded; no audio from the bot into the room (packet / platform mute check).

**Apply to Developer Preview in parallel**, do not wait for this phase. Media is the off-ramp.

### Phase 5 — Bot speaker streams (why C is worth the tax)

- Enable separate-stream audio on Meet. Transcribe per `participant_id`. Speaker column = platform display name.  
- Two people on one laptop stay one label (the device).  
- Fallback to mixed stream + Unattributed if separate streams fail (feature-flag / 4-core bots — treat as cost).  
- Do not run live diarization on the mix *and* print names. That reintroduces guessed “Ada”.

### Phase 6 — Zoom web/desktop and Teams (still C, still stopgap)

- Same BaaS, same mute/label/confirm.  
- Zoom: implement **OBF** (user must already be in the call) or tell them honestly we cannot join an external Zoom until they are in it. Do not ship a pre-OBF SDK bot. Prefer Zoom **RTMS** as a future Tier-2-equivalent; until then the visible bot is the stopgap.  
- Teams: expect lobby + `RequireApprovalWhenDetected`. If the tenant is `BlockDetectedBots`, refuse with that reason. We will not impersonate a compliance-recording bot.  
- Extension remains the path for Zoom/Teams **web** when they do not want a participant.

### Phase 7 — One meeting record + calendar link

- Link `meetingId` to calendar event / Meet space / Zoom uuid.  
- After the call, overlay Tier 1 named entries onto live notes where timestamps align (best-effort, labelled).  
- Coverage gaps already exist (`recordGaps`); show them.  
- Calendar “send the bot 2 minutes after start” is **confirm once per event** (or a Watcher they can pause). Never a silent default.

### Phase 8 — Commitments in the sidebar

Scribe already extracts proposals (`I'll…`) as **unconfirmed**. Show them in the panel; Confirm goes through the existing gateway + autonomy floor. No send from the extension or the bot.

Can overlap Phase 5–7.

### Phase 9 — Meet Media (Tier 2) and retire the Meet bot

When `connectTier2` completes against this project for a real hosted meeting:

- Attempt Media first (existing ladder).  
- If Media connects: **do not send a Meet bot**. The sidebar shows “Listening (Meet)” not “AllTheWay notes is in the room.”  
- Keep the bot for Zoom/Teams until those have a sanctioned listen API we are enrolled in.  
- Restricted-scope CASA must be in flight or done before we store Media audio. Prefer audio-only scope.  
- Recall Direct Connect (or equivalent) is acceptable so we do not own libwebrtc. The contract is: Media is still *our* meeting record, their pipe.

**Revisit trigger:** first successful Media join in production. Kill-switch the Meet bot behind a flag the same day.

---

## Requirements that must move (do not silently contradict)

| Id | Today | Proposed |
|---|---|---|
| **FR-C3** | Live listening requires the user to be **host**. | **Media:** host + Google’s initiation dialog. **Tab capture:** anyone in the Chrome tab who disclosed. **Bot:** anyone who confirmed send-in-the-room; **a host must admit**; indicator for the whole time it is in the roster. |
| **FR-C4** | Never claim it can speak. | Unchanged. Bot mute is structural (no send transceiver / platform mute + we never send uplink audio). |
| **FR-C5** | Live → after-call → extension. | **Media → bot (opt-in) → after-call → extension.** Honest labels: listening / in the room / read afterwards / none. |
| **FR-C7** | If Meet API refuses, fall back or say no — **not join as a guest (Won’t).** | **Superseded in part by ADR 0007.** Media refusals (underage / E2E / watermark / hardware) still do not get a sneaky join. A **labelled, admitted** bot is a different rung, only when they opted in. If the platform refuses the bot (BlockDetectedBots, E2E, watermark), fall back — do not scrape around it. |

PRD “What we refuse / a meeting bot that joins as a guest” and v3.5 “No meeting bot that joins as a guest” are **superseded** by ADR 0007 for the stopgap. The *unannounced* bot remains a Won’t.

---

## Options considered

| Option | Why it won or lost |
|---|---|
| **A + C (chosen)** Sidebar + attribution ladder; guest bot as opt-in stopgap until Meet Media | A is the product. C is the only legal way to get live named streams and non-Chrome rooms before Media. Bot is not default. |
| **A only** (previous recommendation) | Lost because Media enrolment is not a date we own, and tab audio cannot name speakers. Reversible if C’s lobby deny rate makes it unused. |
| **B** Teach WalkCroach to join meetings | Wrong purpose, CWS, two codebases, no capture pipeline. |
| **C only** (bot as the product) | Lost: Granola/Fathom evidence that the bot *is* the resentment. We would spend the trust the manifest bought. |
| **D** Wait for Meet Media | Still the Meet end-state. Not a plan for Zoom desktop or for mixed-room Meet this quarter. |
| **E** Live diarization on mixed tab audio | Model table: **not supported** on the live transcribe endpoint. |
| **F** Own Playwright bot | Lost to 2026 detection and maintenance. |
| **G** Zoom RTMS / Teams compliance recording as C | Wrong API class; longer partner certification. Future Tier-2 equivalents, not the stopgap. |

---

## Fitness functions / revisit

- Phase 0: gateway test that `disclosed: true` is required on **all** capture authenticators (extension socket **and** bot start).  
- Phase 4: 5-minute knock timeout surfaces as `not_admitted`; bot never has an unmute path in our code.  
- Phase 5: speaker column on a 3-person Meet matches platform names ± one device-share exception.  
- Reopen live named-speakers on **tab** audio if Google adds diarization to `gemini-3.5-transcribe-live-preview`.  
- **Retire Meet bot** when `connectTier2` can complete against this project.  
- Reopen host_permissions if a hashed `*.run.app` host is required for the socket (README already warns).  
- Reopen “bot as default” only if extension capture share falls below a measured threshold *and* lobby admit rate is high — defaulting the bot is a commercial decision, not an engineering convenience.

---

## Decision / Ask

**Decided (2026-08-31, owner):**

1. Phase 3a (Meet caption content script) is allowed in the Chrome listing.  
2. Bot-hours are **Max only** (not Team).  
3. Apply to the Workspace Developer Preview **two weeks from 2026-08-31** (target ~2026-09-14), not this week.  
4. Bot vendor (Recall EU vs alternative) waits on a finance review. Do not sign a BaaS until that lands.  
5. Phase 0 and Phase 1 shipped in tree. Phases 2–4 are in tree as of 2026-08-31: cite-or-drop, Meet captions, overlay, Max-only bot contract. The guest notetaker does **not** knock until finance signs a vendor.

WalkCroach is a separate product. A screenshot of it is not a meeting-joiner requirement.

---

## Sources (research cut 2026-08-31)

- [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) — Meet Media still preview.  
- [Get started with Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/get-started) — all participants enrolled; restricted media scopes; age / hardware limits.  
- [Meet Media API concepts](https://developers.google.com/workspace/meet/media-api/guides/concepts) — exactly three recvonly audio transceivers.  
- [Restricted scope verification / CASA](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).  
- [Safeguarded guest admit flow](https://workspaceupdates.googleblog.com/2026/02/safeguarded-guest-admit-flow-in-google-meet.html) (24 Mar / 7 Apr 2026).  
- Vendor corroboration of bot risk label + ~5 min waiting-room timeout: [Metaview: Google Meet](https://support.metaview.ai/joining-your-calls/video-conference-calls/google-meet).  
- [Require explicit consent for Gemini notes / recordings / transcripts](https://workspaceupdates.googleblog.com/2026/04/require-explicit-consent-for-take-notes-with-Gemini-recordings-and-transcripts-in-Google-Meet.html) (from 5 May 2026).  
- [Manage external bots in Teams](https://learn.microsoft.com/en-us/microsoftteams/manage-external-bots).  
- [Zoom OBF / attribution from 2 Mar 2026](https://developers.zoom.us/blog/transition-to-obf-token-meetingsdk-apps/).  
- [Recall.ai separate audio per participant](https://docs.recall.ai/docs/how-to-get-separate-audio-per-participant-realtime); [Meet Media Direct Connect](https://docs.recall.ai/docs/meeting-direct-connect-for-google-meet-media-api).  
- Competitive “bot tax”: `docs/AllTheWay-v3.5-Product-Design.md` §4.3 (Granola discretion, Fathom bot complaint), research date 2026-08-27.
