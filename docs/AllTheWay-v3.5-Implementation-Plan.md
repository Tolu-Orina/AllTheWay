# AllTheWay v3.5 — Implementation Plan

*Companion to [Product Design Enhance v3.5](AllTheWay-v3.5-Product-Design.md). The design says what the product must feel like and why people would pay. This says how, in what order, against which files, to what proof, and what is deliberately left alone.*

**Date:** 2026-08-27 · **Prerequisite:** v3 surfaces exist in the tree; Phases 0–8 of the A2A plan are deployed · **Status:** proposed · **Not v4.**

---

## 0. How to read this

Nine cuts, **0–7**, matching the design's sequencing table, with **1b** kept as its own cut because it is the difference between a planner and a product. Each cut uses the same seven headings as the v3 plan, for the same reason:

**Goal · Data model · Services & infrastructure · Interface · Requirements met · How it is proven · What could go wrong**

Inherited, non-negotiable:

- Tests before the mechanism for anything that spends, sends, or grants a plan.
- Verify by running. Typecheck is not a proof in this repo (`tsc -p tsconfig.json` still typechecks nothing if someone uses the wrong script).
- He commits and pushes. Finish the work, run the checks, list the files, stop.
- Terraform: `fmt` → `validate` → `tflint` → `plan` read → `apply`.
- Cross-user retrieval remains a breach. No collection-group queries. Sharing still grants an artifact, never a corpus.

**Default answers to the design's open questions**, used so this plan is executable. The owner can invert any of them before the relevant cut starts; until then they are locked:

| # | Question | Default in this plan |
|---|---|---|
| 1 | Team in v3.5 | **Waitlist / mailto.** Meter row stays. No Stripe Team price. Sharing remains Team/Max in code — Free/Plus users see the existing human refusal plus an upgrade that, for now, says Team is not self-serve. |
| 2 | Max in v3.5 | **Hidden from Checkout and marketing** until a confirmed, cost-disclosed video path exists in the UI. Meter row stays. |
| 3 | Documents cap | **Add meter `documents`** to `libs/metering` and enforce at ingest. Free 5, Plus 200, Team/Max unmetered — matching the v3 manifest. |
| 4 | Search | **Shallow client filter** on Work (title match). Remove the `/` kbd lie until a real shortcut exists. |
| 5 | Currency | **GBP.** Marketing, Checkout, Usage, invoices. |
| 6 | First effector | **`google_calendar.create_event` only.** Gmail send is implemented and stays unwired. Inbox read stays v4 (CASA). |

---

## 1. The production bar (v3.5 additions)

Everything in the v3 plan §1 still holds. These are extra, because this version sells and this version *acts*.

| Rule | Why | Where it lands |
|---|---|---|
| **The browser never decides what runs.** Yes posts a decision; the gateway executes from a **server-stored** pending confirm. A client-supplied `actions[]` is ledger colour, not authority. | Otherwise a modified client sends mail the model never proposed. | Cut 1b |
| **The orchestrator remains a planner.** Effects go gateway → connector-gateway A2A `invoke(confirmed=true)`. | The orchestrator card already says it never executes. Teaching it to execute would duplicate the autonomy floor. | Cut 1b |
| **Stripe is not the entitlement engine.** Webhooks write `subscriptions/{uid}.tier` (+ status, ids). `plan_for()` and `check()` stay in `libs/metering` / connector-gateway. | Two sources of truth is how an outage upgrades everyone. | Cut 5 |
| **Fulfillment is the webhook, never the success URL.** | Users close the tab. Query strings are forgeable. | Cut 5 |
| **Voice is refused before the socket is useful**, not after hangup. Recording after success remains. | A limit you discover by talking is not a limit. | Cut 1b |
| **Watcher triggers we cannot observe are not offered.** No Gmail-read copy. | Recents bug at product scale. | Cut 3 |
| **Marketing numbers are the meter.** `check-plan-table.py` grows to cover the landing fixture. | Three tables was the lie. | Cut 0 + 5 |

---

## 2. Cross-cutting architecture (read once)

### 2.1 Why the gateway becomes the actor

Verified: there is **no** connector-gateway client in `services/gateway`. The UI's Yes handler writes a ledger row. Session detail copy is accurate. Connector-gateway `invoke()` already does grant → org policy → autonomy floor → quota → MCP → screen response. Calendar `create_event` exists (`google_calendar_server.py`, RFC 3339 `starts_at`, one-hour default end).

**Chosen:** after a confirmed decision, the **gateway** calls connector-gateway over A2A with a Google identity token (ADR 0005), `confirmed=true`, and the stored tool arguments.

**Rejected: orchestrator executes.** Would contradict the published card, put effects on the planning path, and make a Vertex timeout leave a half-sent calendar event inside a turn stream.

**Rejected: browser calls connector-gateway.** Public surface, model credential adjacent, autonomy floor skippable.

**Trade-off:** gateway now has a second A2A dependency. A confirm is slower (second hop). That is acceptable: confirm is rare and irreversible-adjacent. Planning stays the fast path.

```
Browser  --SSE-->  Gateway  --A2A-->  Orchestrator     (plan / clarify / confirm)
Browser  --POST--> Gateway  --A2A-->  Connector-gateway (Yes: invoke)
                              \---->  Firestore artifacts + sessions
```

#### 2.1.1 Invoker graph — this is a real architecture amendment

Today `infra/modules/stack/main.tf` `invoker_graph` is:

```
connector-gateway = ["orchestrator", "watcher-runtime", "registry"]
```

The comment says the Agent Gateway (connector-gateway) is reachable only by the two things that *act*, and **never the browser**. The HTTP **gateway is not on that list**. `peer_env_vars.gateway` has `ORCHESTRATOR_URL`, `REGISTRY_URL`, `LIBRARIAN_URL`, `SCRIBE_URL` — **not** `CONNECTOR_GATEWAY_URL`. `services/gateway/src/env.ts` has no connector URL. `a2a.ts` exports `orchestratorClient` only.

If Cut 1b ships without Terraform, production Yes is a 403 Cloud Run cannot distinguish from "the product is broken."

**Chosen:** add `"gateway"` to `connector-gateway`'s invoker list, and add `CONNECTOR_GATEWAY_URL` to `peer_env_vars.gateway`. Update the comment in the same diff:

> Attended confirm from the user-facing gateway is allowed: the gateway already holds the Firebase session (same reason it may call scribe). The browser still has no path. Unattended acting remains orchestrator (planning only) and watcher-runtime (which still must not invoke calendar in v3.5).

**Rejected: keep the graph and have the orchestrator invoke.** That reopens "the orchestrator never executes." A Vertex timeout on a follow-up execute skill would leave calendar half-done inside a planning stream. The published card stays honest.

**Rejected: HTTP from gateway to connector-gateway `/invoke`.** There is no public REST invoke. The A2A executor (`a2a_executor.py`) is the door. Use `agentClient(env.connectorGatewayUrl)` — same `authenticatingFetch` as orchestrator.

#### 2.1.2 Exact A2A payload (do not invent a second protocol)

`ConnectorExecutor._request_of` reads a **data part**, not prose:

```
{
  "connector": "google_calendar",
  "tool": "create_event",
  "arguments": { "title": "Lunch", "starts_at": "2026-08-28T12:00:00Z" },
  "confirmed": true,
  "costAcknowledged": false
}
```

`user` is **not** taken from this JSON. It is `context.tenant or "user"`. Planning calls today send `tenant: ""` (`orchestrator.ts`). An empty tenant on invoke would bill and grant as `"user"` — a cross-tenant disaster of the same family §1.4 forbids.

**Rule:** every connector-gateway call from the gateway sets `tenant` to the Firebase uid. Tests must fail if tenant is empty in production code paths.

Grant: `_grant_from(payload)` is optional. Tokens live in connector-gateway's `FirestoreRefreshTokens`. If no grant in the payload, `invoke` still uses `token_store` + `user`. **Do not** let the browser supply a grant. Gateway may omit `grant` and rely on the token store, or load the user's Google grant from its own connector repos and pass it — the floor still ignores a forged ceiling. Prefer omit-grant and let the connector-gateway load tokens by uid.

Outcomes:

| A2A task state | Meaning | Gateway maps to |
|---|---|---|
| COMPLETED + result artifact | Event created | `did: "calendar"`, event id from `data.id` |
| INPUT_REQUIRED | `NOT_CONFIRMED` or `NEEDS_CONSENT` | Should not happen if we sent `confirmed: true` and they are connected; if consent: `did: "none"`, connect copy |
| REJECTED | quota, unregistered, unavailable | `did: "none"`, `reason` verbatim |

#### 2.1.3 Decision route becomes an actor, not a ledger stamp

Today `POST /sessions/:id/decision` (`index.ts` ~166) records and returns `{ id }` 201. The comment says the browser is the only place that knows Yes was pressed — still true for *intent*. Execution must not trust the body's `actions[]`.

**New contract** (extend, do not break the ledger write):

Request: unchanged shape (`kind`, `summary`, `actions`, `modality`, `confidence`). `actions` remain **ledger colour**.

Response `201`:

```
{
  id: string,                    // ledger row
  did: "calendar" | "none",
  detail: string,                // human, shown under the gate
  artifactId: string | null,
  calendarEventId: string | null
}
```

`409` if `kind === "confirmed"` and no `pendingConfirm`. `404` if session missing.

Decline/correct: clear `pendingConfirm`, write ledger, `did: "none"`, no invoke.

Idempotency: `users/{uid}/sessions/{id}.lastAct = { turnId, did, calendarEventId, artifactId }`. Same `pendingConfirm.turnId` already acted → return `lastAct` without a second MCP call.

### 2.2 Pending confirm must live on the session document

Today the confirm payload exists only in React state. Refresh, a second device, or a companion chip that sends "Yes, go ahead" as a **new turn** all lose it.

**Chosen:** when the stream emits `kind: "confirm"`, the gateway `set({ pendingConfirm, updatedAt }, { merge: true })` on `users/{uid}/sessions/{id}` before the SSE event is flushed.

```
pendingConfirm: {
  turnId: string
  summary: string
  actions: { label, action, reason, connector?, tool?, arguments? }[]
  at: Timestamp
}
```

Yes loads that document. If `pendingConfirm` is missing, the API returns `409` with "There's nothing waiting to confirm." It does not invent an action from the POST body.

After success or decline, `pendingConfirm` is deleted in the same batch as the ledger write.

Mapping `action` (plan_validation vocabulary: `create_task`, `send_external`, …) onto connector/tool is **server-side and allow-listed**. v3.5 allow-list:

| `action` | Connector | Tool | Arguments derived from |
|---|---|---|---|
| `create_task` | `google_calendar` | `create_event` | title ← label/summary; `starts_at` ← ISO in the action reason or "now + 1h" if absent — **if unparseable, do not guess a date: return a clarify-shaped error and do not invoke** |

Anything else: do not invoke; still write the plan artifact; tell the user this kind of step is not available yet.

### 2.3 Session parent documents

Verified: Firestore **does not return** documents that only have subcollections. Console shows them in italics. Voice writes `sessions/{id}/transcript/…` without a parent. `listSessions` is `orderBy("updatedAt")` — those rows never appear.

**Chosen:** `ensureSession(uid, id, { title })` uses `set(..., { merge: true })` with at least `title`, `updatedAt` (server timestamp), `done`, `total`, `scope`, `plan`, `companionNote`. Called from:

- first text token / first confirm / first done of a turn
- first successful voice auth (same id the browser sent)
- New → allocate id, then first send

Title: first user utterance, trimmed to 80 chars, newline collapsed. Later turns update `updatedAt` and `plan` from the turn result; they do **not** overwrite title unless title is still `"New work"` / empty.

**Rejected: `POST /sessions` as the only create path.** The design forbids sessions as a prerequisite. New is allowed as "start a conversation" which allocates an id locally; persistence still happens on first output.

### 2.4 Watcher fire: one scheduler, not one Cloud Scheduler job per user

Verified: topic `watcher-trigger` exists; nothing publishes to it. `execute_run` plans and returns `"done"` without `invoke`. Quota is not checked before a run.

**Chosen (industry default for SaaS reminders):** one Cloud Scheduler job (e.g. every 5 minutes) → watcher-runtime `/events/due` → query `running == true AND nextRunAt <= now` **under each user's path is not a collection group**. So: store due work on a **scheduler index the runtime already owns**, or have the gateway write `watchers/{uid}_{watcherId}` into a **project-level** collection `watcherSchedule/{id}` with `uid` in the path of the *document id* (`{uid}_{watcherId}`) and fields `uid`, `watcherId`, `nextRunAt`. The scan is `watcherSchedule.where("nextRunAt","<=",now).limit(N)` — **this is not a user-data corpus.** It holds pointers. The run still loads `users/{uid}/watchers/{id}`.

**Rejected: collectionGroup on `watchers`.** Forbidden by tenant-isolation guard.

**Rejected: one Scheduler job per watcher.** Quota, IAM, and cleanup hell. Google's own guidance is a single cron plus application state.

**Due work then:** publish existing `watcher-trigger` with `{ uid, watcherId, runId }`. Runtime: `check(WATCHER_RUNS)` **before** orchestrate; if refused, write a run `blocked` with "allowance spent"; if allowed, plan; if confirm needed, `awaiting_review`; if the plan is calendar-create and ceiling permits **and** this is v3.5, still **do not auto-invoke** unless ceiling is `send_automatically` — default create is `draft_only` / `send_after_review`, so the morning digest is the product. Cut 3 may stop at "plan + awaiting_review" plus quota. Auto-invoke of calendar from a watcher is **out of v3.5** (P7: propose, don't rearrange). That is how we avoid becoming Motion.

### 2.5 Stripe: metadata on the Subscription, refetch, idempotent events

Verified industry pattern (2026):

- Verify **raw body** with `constructEvent`. Express `json()` will break signatures — the webhook route must use `express.raw({ type: "application/json" })` mounted **before** or beside the JSON parser for that path only.
- Store `event.id` with a unique constraint **before** side effects. Duplicate → 200, no second write.
- `client_reference_id` = Firebase uid on Checkout Session.
- **`subscription_data.metadata.firebaseUid`** — Checkout Session metadata does **not** appear on `customer.subscription.*` events. This is a widely hit footgun.
- Also `metadata.firebaseUid` on the Customer at create.
- **Refetch** `subscriptions.retrieve(id)` inside the handler; do not trust a stale `updated` payload if `deleted` already landed.
- Return 200 for ignored event types. Return 500 only when you want Stripe to retry (Firestore down).
- Success URL `/app/you?billing=ok` polls `GET /usage`; never grants.

Prices: Dashboard (or Terraform later) products with lookup keys `plus`. No Team/Max Checkout objects until those defaults change.

Webhook URL: gateway `*.run.app`, not Firebase Hosting (ADR 0001, same as SSE).

### 2.6 I18n provider

Verified: `I18nProvider` wraps only `AppLayout`. Auth and `/offline` call `useT()` and throw outside the provider.

**Chosen:** wrap in `web/src/main.tsx` around `App`, once. Do not duplicate providers. Locales remain unreviewed drafts — that does not block wrapping.

### 2.7 ConfirmGate — one component, two hosts

Extract from `SessionDetail.tsx` (~Confirm UI around line 318) into `web/src/app/ConfirmGate.tsx`.

Props:

```
summary: string
options: string[]
actions: ProposedAction[]
busy: boolean
outcome: { did, detail } | null
onConfirm: () => void
onDecline: () => void
```

Hosts: `SessionDetail`, `CompanionPanel` (replace `send(option)` on confirm-phase chips), later `CommitmentCard` wrapper (Cut 6), Watchers create (Cut 3).

Voice: `VoiceCaptions` grows the same two buttons when the **text** turn on that session is `phase === "confirm"`. Spoken "yes" is **not** parsed in v3.5; the buttons are the product.

Copy after Yes (replace the honest-but-dead line):

| `did` | Copy |
|---|---|
| `calendar` | "It's on your calendar." (link to `https://calendar.google.com` optional) |
| `none` + not connected | "Connect Google Calendar in You → Connected accounts, then tap Yes again." |
| `none` + unparseable time | "I need a day and time before I put this on the calendar." |
| `none` + not allow-listed | "I saved the plan as work. This kind of step isn't something I can do yet." |
| `none` + refusal.reason | Show `reason` unchanged (autonomy floor / quota language is already human) |

Never: "connectors arrive in the next phase."

---

## 2a. Inherited verification commands (every cut)

These are the v3 plan's "verify by running" set. A cut that only typechecks is not done.

```
npm --workspace @alltheway/gateway test
npm --workspace web run typecheck          # tsc -b, not tsc -p tsconfig.json
python scripts/check-plan-table.py
python scripts/check-tests-listed.py
python scripts/check-locales.py            # when any t() key is added
npm run guards
docker build --target test -f services/gateway/Dockerfile .
docker build --target test -f services/connector-gateway/Dockerfile .   # Cut 1b+
docker build --target test -f services/watcher-runtime/Dockerfile .     # Cut 0, 3
```

Terraform, when a cut touches `infra/`:

```
terraform fmt -check -recursive
terraform validate
tflint
terraform plan   # read; apply only after
```

Do not probe generative endpoints with a real prompt. Invalid payload → 400 is the existence check.

---

## 3. Glossary for implementers (user-facing strings)

Use the design §6.6 / §11 nouns in UI copy. Internal collection names stay `sessions`, `watchers`.

| User sees | Route / component |
|---|---|
| Today | `/app` (keep file `Home.tsx` until Cut 4, then rename if cheap) |
| Work | `/app/work`, `/app/work/:id` (redirects from `/app/sessions` in Cut 4) |
| Watchers | `/app/watchers` |
| You | `/app/you` (redirect from `/app/profile`) |
| What it has learned | former Cognitive Profile heading |
| Why it did that | former Transparent Trace, only when real |

---

## Cut 0 — Honesty

### Goal

A new account cannot click a control that no-ops, cannot 404 on a marketed link we still show, cannot crash on `/login` because of i18n, and cannot be shown a digest that is quietly wrong. No new product capability. Trust repair.

### Data model

**Digest run documents must match the contract the runtime already writes.**

| Today (broken) | Canonical (contracts `WatcherRunSchema`) |
|---|---|
| digest.ts / digest.py / digest.test.ts filter `status == "awaiting_confirmation"` | `state == "awaiting_review"` |
| digest reads `summary` | runtime writes `detail` (and `reason`) |

Change the **readers and tests**, not the runtime enum. `awaiting_review` is the product noun; `awaiting_confirmation` was an invented alias. Seed data already uses `state: "awaiting_review"`.

Optional additive: `sessionId` on a run if missing, so "decided" set in digest.ts works. If runs have no `sessionId`, awaiting items never clear after a ledger write — verify seed and runtime `record_run` and add `sessionId` if absent.

Meetings: `GET /settings/meetings` (scribe already has POST). Return `{ enabled: boolean }`.

### Services & infrastructure

- `services/gateway/src/repos/digest.ts` — filter and field names.
- `services/watcher-runtime/app/digest.py` — same.
- `services/gateway/src/digest.test.ts` — fixtures use `state` / `detail`.
- `services/gateway/src/routes/meetings.ts` — GET settings; UI hydrates.
- `web/src/main.tsx` — `I18nProvider` above `App`.
- `web/src/App.tsx` — routes: `/contact` (simple mailto page or `Contact.tsx`), `/privacy` stub linking to real policy if it exists, **or remove footer links that have no page**. Do not leave 404s in the footer. Minimum: Contact (mailto), Privacy (existing if any, else a short honest page). Drop Careers/Blog/About/Status/Trace/Security from the footer until they exist.
- Shared artifact: add `Route path="artifacts/:id"` under `/app` that renders `Canvas` with `owner` search param (Comments already accepts `owner`). `SharedWithMe` keeps its links.
- `scripts/check-plan-table.py` — not yet marketing (that's Cut 5); in Cut 0 **stop the landing from claiming Free has no Watchers** by editing `pricing.tsx` copy to not lie, even if the full table unification waits. Interim: Free line "Watchers included, metered" not "No Watchers". Currency: `£18` to match meter. Team CTA → `/contact`. Remove "Start free trial". Plus href `/signup` (no fake `?plan=` until Cut 5).

No Terraform.

**Files (Cut 0) — expected touch list**

| File | Change |
|---|---|
| `services/gateway/src/repos/digest.ts` | Filter `state === "awaiting_review"`; read `detail` (fallback `summary` for old docs) |
| `services/gateway/src/digest.test.ts` | Fixtures match runtime; add a test that `awaiting_confirmation` is **not** listed |
| `services/watcher-runtime/app/digest.py` | Same field names |
| `services/watcher-runtime/tests/` | Digest tests if present |
| `services/gateway/src/routes/meetings.ts` | `GET /settings/meetings` → `{ enabled }` |
| `web/src/app/Meetings.tsx` | Hydrate switch from GET; reload after POST |
| `web/src/main.tsx` | `I18nProvider` around `App` |
| `web/src/app/AppLayout.tsx` | Keep inner provider **or** remove it once `main.tsx` wraps App — nested providers are harmless but noisy; one wrap is enough |
| `web/src/app/AppTopBar.tsx` | New → `/app/sessions?new=1` (Cut 1 honours the query; until then navigate is still better than a no-op) |
| `web/src/app/screens/Sessions.tsx` | Same New handler |
| `web/src/app/Sidebar.tsx` | Delete `RECENTS`; omit heading or load API |
| `web/src/app/screens/Home.tsx` | Delete `TRACE` constant and render |
| `web/src/app/CompanionPanel.tsx` | Fix comment; Recovery on error phase |
| `web/src/app/screens/SessionDetail.tsx` | Mount Recovery |
| `web/src/app/AccountMenu.tsx` / `AppLayout.tsx` | Mobile header uses AccountMenu; remove Bell |
| `web/src/app/screens/Watchers.tsx` | `isEmpty` copy, no Create yet |
| `web/src/App.tsx` | `/contact`, `/privacy` (honest short pages); `artifacts/:id`; drop footer 404s |
| `web/src/components/blocks/site-footer.tsx` | Only live links |
| `web/src/components/blocks/pricing.tsx` | £, Watchers on Free, no trial, Team `/contact`, no Max |
| `web/src/app/SharedWithMe.tsx` | Confirm links match new route |

### Interface

Dead chrome — **remove or wire**, P1:

| Control | Cut 0 action |
|---|---|
| AppTopBar **New** | Wire to `/app/sessions` with `?new=1` **or** disable until Cut 1. Prefer navigate to Sessions with a query Cut 1 will honour. Do not leave a brand button with no handler. |
| Sessions New / empty CTA | Same. |
| Search | Keep input; **remove `<kbd>/</kbd>`**; `onChange` filters nothing yet **or** hide the control until Cut 4. Prefer hide on desktop too if it claims "anything". |
| Bell | Remove from mobile header. |
| Mobile Avatar | Replace with `AccountMenu`. |
| Sidebar Recents | Empty array from API (`listSessions` slice 5) or omit heading when empty. **Delete `RECENTS` constant.** |
| Home `TRACE` | Delete the block. If last turn has real `trace`, Cut 2 can restore a short "Why it did that". |
| Companion local-only comment | Rewrite to match `useTurn`. |
| Recovery | Import in `SessionDetail` and `CompanionPanel` on `phase === "error"`. Map error string → `FailureKind` (default `unknown`). |

Watchers: add `isEmpty` empty state ("No watchers yet") **without** a Create button until Cut 3 — a verb we cannot keep is worse than none.

### Requirements met

Design P1, §2.2 items 1–16 as listed (billing wait for Cut 5). Auth does not throw. Digest awaiting list can populate from real runs.

### How it is proven

- `npm --workspace @alltheway/gateway test` — digest tests fail on the old field, pass on `state`.
- Manual: sign out on a phone-width viewport.
- Manual: `/login` renders.
- Manual: `/contact` is not a Router miss.
- Manual: SharedWithMe row opens Canvas or an honest empty, not a blank route.
- `npm run guards`.
- Browser: click every primary chrome control on a fresh account; none no-op except Watchers Create (absent).

### What could go wrong

- Changing digest tests without changing runtime writers leaves production quiet. **Change readers to match writers**, not the reverse, unless you also migrate documents.
- A Privacy page that invents GDPR claims. Keep it short and true.
- Mounting Recovery without `turnId` — use `sessionId + timestamp`.

---

## Cut 1 — Work exists

### Goal

Talking (text or voice) produces a row you can open tomorrow. New starts a conversation, it does not POST an empty session as a ritual. Leaving work publishes `session-ended` so the synthesizer can learn.

### Data model

`users/{uid}/sessions/{id}` fields (all present on first `ensureSession`):

```
title: string
updatedAt: Timestamp
done: number
total: number          // min 1 so SessionSchema.total.positive() holds — use 1 when plan empty
scope: string          // "" until a plan exists
plan: { label, done, action }[]
companionNote: string
correction: { was, now } | null
pendingConfirm: ... | delete in 1b
```

Id generation: `nanoid` or `crypto.randomUUID()` in the client for New; companion keeps `"companion"` as the **continuing** thread (design: one companion conversation). **Voice must use the same id as the visible work**, not `"live"` when a work item exists.

`ensureSession` is idempotent merge. First write sets title from utterance if title empty.

`POST /sessions/:id/end` already exists. Call it from Work unmount / "Done for now". Do not call it on every route change (would spam synthesizer). Call when: user clicks Done, or the work id changes after a session that had at least one turn.

### Services & infrastructure

- `services/gateway/src/repos/sessions.ts` — `ensureSession`, `touchSession(plan, note)`, `clearPendingConfirm` (stub until 1b).
- `services/gateway/src/orchestrator.ts` / `index.ts` stream + POST turn: after a terminal event (`done`, `confirm`, `clarify`, `error` still touches `updatedAt`), call `touchSession`. On confirm, wait for 1b to persist `pendingConfirm`; in Cut 1 persist plan + note anyway.
- Voice `relay.ts`: after auth, `ensureSession(uid, sessionId, { title: "Voice" })` then update title from first transcript line if still default.
- `web/src/app/data.ts` — no create API required if ensure is server-side on turn. Optional `POST /sessions` that only **allocates** `{ id }` for New — nicer for the URL. **Chosen:** `POST /api/sessions` body `{}` returns `{ id }` and `ensureSession` with title `"New work"`, total 1, done 0. First message retitles.
- `web/src/app/use-voice.tsx` `resolveSessionId`: current work id from route, else companion, **never a disconnected `"live"`** once Cut 1 ships. `"live"` only if somehow no uid (should not happen).

**Files (Cut 1)**

| File | Change |
|---|---|
| `services/contracts/src/index.ts` | SessionDetail may ignore unknown `pendingConfirm` until 1b; list schema unchanged |
| `services/gateway/src/repos/sessions.ts` | `ensureSession`, `touchSession`, title lock |
| `services/gateway/src/index.ts` | `POST /sessions` → `{ id }`; stream/turn/voice call ensure; keep `POST …/end` |
| `services/gateway/src/orchestrator.ts` | After terminal SSE event, `touchSession` (confirm persistence of `pendingConfirm` is 1b; Cut 1 still writes plan/note/`updatedAt`) |
| `services/gateway/src/voice/relay.ts` | `ensureSession` after auth |
| `services/gateway/src/sessions.test.ts` | **New.** Parent exists after turn; list query returns it; merge does not wipe title |
| `web/src/app/data.ts` | `createSession()` |
| `web/src/app/screens/Sessions.tsx` | New / empty CTA call create then navigate |
| `web/src/app/AppTopBar.tsx` | Same |
| `web/src/app/use-voice.tsx` | Session id unification |
| `web/src/app/screens/SessionDetail.tsx` | On leave / Done: `POST /sessions/:id/end` |
| `web/src/app/Digest.tsx` | Link to `/app/sessions/:id` when `sessionId` present |

`ensureSession` implementation sketch (do not cargo-cult into a second store):

```
await sessions(uid).doc(id).set({
  title: existing || clip(utterance) || "New work",
  updatedAt: FieldValue.serverTimestamp(),
  done: plan.filter(s => s.done).length,
  total: Math.max(plan.length, 1),
  scope: scope ?? "",
  plan: plan ?? [],
  companionNote: note ?? "",
  correction: null,
}, { merge: true })
```

First write must include every field `SessionDetailSchema` requires, or `GET /sessions/:id` 500s on parse.

### Interface

- Sessions New / empty / top bar: `POST /sessions` → navigate to `/app/sessions/:id`.
- Composer on that page works as today (`useTurn(id)`).
- Home Continue: `homePlan` starts working because list is non-empty.
- Digest decision link: if `sessionId` present, `/app/sessions/:id`, else list. Cut 4 will rewrite to `/app/work/:id`.

### Requirements met

Design P2. Plan §16.5 "do not fix by wiring the button as the only path" — both paths exist; talking without New still upserts (companion id `companion` appears in the list). That is correct: the companion *is* work.

### How it is proven

- Fresh emulator user, no seed: send one companion message → `GET /sessions` returns one row with a title from the text.
- Voice 10 seconds → parent document exists; list query returns it.
- `POST /sessions` then abandon without sending → a "New work" row exists. Acceptable. Optional: delete if never touched after 24h — **not in v3.5**.
- End session → Pub/Sub `session-ended` message (log).
- Typecheck + gateway tests: `ensureSession` merge does not wipe plan.

### What could go wrong

- `total: 0` fails Zod `.positive()`. Always `Math.max(plan.length, 1)`.
- Companion flooding the list as the only item forever — good. Users who want a new piece of work hit New.
- Voice and text still forking if `resolveSessionId` is not updated in the same cut. **Same PR.**

---

## Cut 1b — One action

### Goal

Yes puts an event on Google Calendar when connected, or says exactly why it did not. Every confirmed plan is also an artifact, so Canvas is not empty after work. Voice with 0 minutes remaining never opens Vertex.

### Data model

`pendingConfirm` as §2.2. Ledger row unchanged.

Artifact on confirm success (and on confirm of a plan with no allowed effector):

- `kind: "checklist"` or `"summary"`
- `title`: session title
- `sessionId`
- `producedBy: "agent"`
- bytes: markdown of summary + checklist of steps
- provenance: orchestrator card version if known, else `"orchestrator"`

Reuse `repos/artifacts.ts` create + first version. Do not invent a second store.

`subscriptions` usage: voice check uses existing `readUsage`.

### Services & infrastructure

**New A2A client** in gateway, same pattern as `orchestrator.ts` / `a2a.ts`: identity token, audience = connector-gateway URL. Env `CONNECTOR_GATEWAY_URL` — add to gateway Cloud Run env in Terraform (stack already knows service URIs). IAM: gateway SA already needs `run.invoker` on connector-gateway if not present — **verify `service_roles` / invoker members**. If missing, this is the outage class from plan §16.6. Add in the same apply as the env var.

Gateway module `src/act.ts`:

```
actOnConfirm(uid, sessionId): Promise<{ did: "calendar" | "none"; detail: string; error?: string }>
```

Steps: load session → require `pendingConfirm` → pick first allow-listed action → load Google grant (existing connector repos) → if no grant, return `none` + "Connect Google Calendar in You → Connected accounts" → A2A invoke `google_calendar.create_event` with `confirmed: true` → on refusal, surface `refusal.reason` verbatim → clear pendingConfirm → write artifact regardless of calendar success (the plan is still a thing they own) → if calendar failed after confirm, artifact note includes the failure.

**Idempotency:** store `pendingConfirm.turnId` on the ledger. Second Yes with same turnId returns the first outcome (calendar event id in session `lastAct`). Retried Yes must not create a second event. Calendar tool is not idempotent — **gateway must remember `calendarEventId`**.

Voice `relay.ts`: after auth, `readUsage`; if `voice_minutes` remaining is 0 (and limit is not null), close with a JSON error the client already displays. Do not open fake/Vertex. Unmetered Team/Max: skip. Missing subscription: Free, 30, same as everywhere.

Quota check uses the same table as display (`repos/usage.ts`). If display and connector-gateway disagree, that is already a known split; voice lives in the gateway so the gateway table is the one that can refuse.

**Terraform (Cut 1b) — required in the same apply as the code**

```
# infra/modules/stack/main.tf
invoker_graph.connector-gateway = ["orchestrator", "watcher-runtime", "registry", "gateway"]

peer_env_vars.gateway += {
  CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
}
```

`env.ts`: `connectorGatewayUrl: process.env.CONNECTOR_GATEWAY_URL ?? "http://localhost:8091"` (confirm local port against connector-gateway compose). Boot log: `console.info("[gateway] connector-gateway", url or "unset")`. Unset in production must fail the confirm path with a structured error, not hang.

`a2a.ts`: `export const connectorGatewayClient = () => agentClient(env.connectorGatewayUrl);`

**Orchestrator confirm payload — improve if cheap, do not block**

Today `pendingConfirm.actions` is `unknown[]` copied from the artifact. If the orchestrator already emits ISO times in `reason`, parsing is enough. If not, add optional `starts_at` on `ProposedActionSchema` **additive**. Do not wait for a model change to ship the allow-list; unparseable → honest `none`.

**Files (Cut 1b)**

| File | Change |
|---|---|
| `infra/modules/stack/main.tf` | Invoker + env |
| `services/gateway/src/env.ts` | URL |
| `services/gateway/src/a2a.ts` | Client |
| `services/gateway/src/act.ts` | **New.** Allow-list, invoke, idempotency |
| `services/gateway/src/act.test.ts` | **New.** Fake A2A; tenant required; double Yes |
| `services/gateway/src/index.ts` | Decision handler calls `actOnConfirm` |
| `services/gateway/src/orchestrator.ts` | Persist `pendingConfirm` before yielding confirm |
| `services/gateway/src/repos/sessions.ts` | pendingConfirm + lastAct |
| `services/gateway/src/repos/artifacts.ts` | Reuse `createArtifact` |
| `services/gateway/src/voice/relay.ts` | Refuse at connect |
| `services/gateway/src/voice/*.test.ts` | 0 remaining → no Vertex |
| `services/contracts/src/index.ts` | Decision response schema if shared |
| `web/src/app/ConfirmGate.tsx` | **New** |
| `web/src/app/screens/SessionDetail.tsx` | Use it; outcome copy |
| `web/src/app/CompanionPanel.tsx` | Use it; stop `send(option)` on confirm |
| `web/src/app/data.ts` | Parse new decision response |
| `web/src/app/VoiceControl.tsx` | Confirm buttons when phase confirm |
| `web/src/app/CanvasPane.tsx` | Reload artifacts after Yes |

Date parsing: accept RFC 3339 first. Secondary: a substring matching `\d{4}-\d{2}-\d{2}T`. **Do not** send "tomorrow" to Calendar. Default duration is already one hour in the MCP tool.

### Interface

- Extract `ConfirmGate` from `SessionDetail.tsx`. Use in companion: options "Yes" / "No" call `recordDecision`, **not** `send(option)`.
- After Yes: show `did` / `detail`. Delete "connectors arrive in the next phase".
- If `none` because not connected: button "Connect Google" → existing OAuth start.
- Voice captions: if the turn is confirm, show the same Yes/No (design: voice-primary confirm can stay spoken **and** clickable). Add buttons; speaking "yes" still goes to Live, which may `plan_turn` again — **product rule:** click Yes is authoritative for Cut 1b. Spoken yes may still be a new turn until we parse it; do not block 1b on NLU.
- Canvas pane: after confirm, reload artifacts (event or `reload()`).

### Requirements met

Design §2.5.1, P7 (calendar create is user-confirmed, not a watcher), P8, FR-V2 (still gated). Autonomy floor still inside `invoke`.

### How it is proven

- Integration test with connector-gateway fake/calendar dict: confirm → `create_event` called once; second Yes no second call.
- No grant: 200 with `did: "none"` and connect copy; no invoke.
- Unparseable date: no invoke, message to pick a time.
- Voice at 0 minutes: WS closes before PCM; UI shows remaining.
- Artifact appears in `GET /artifacts` after Yes.
- `docker build --target test` gateway + connector-gateway.
- Manual: connected Google, "put lunch on my calendar tomorrow 1pm" → clarify/confirm → Yes → event on calendar.google.com.

### What could go wrong

- Gateway invoker missing → 403/404 on confirm, looks like "Yes broken". Check IAM first.
- `create_task` mapped too broadly (todos, not calendar). Allow-list + only when the model labelled calendar-ish reason **or** require tool args from orchestrator. **Better long-term:** orchestrator confirm payload includes `tool` + `arguments`. **v3.5 minimum:** parse RFC3339 from `reason`/`label`; if missing, don't act.
- Double Yes from companion and session detail: idempotency key = `turnId`.
- Acting on decline: tests that decline clears pendingConfirm and does not invoke.
- Sending `tenant: ""` (as planning does) bills a shared `"user"` bucket and looks up the wrong tokens. **Cut 1b tests must assert tenant === uid.**
- Shipping gateway code before the invoker graph apply: production 403. Same class of outage as v3 plan §16.6.
- Invoking `send_invite` because create_event "isn't enough." That emails a third party. Out of allow-list.

---

## Cut 2 — Today

### Goal

First hour has a job, a composer on the phone, and no fake confidence. Quiet digest is true (Cut 0) or shows decisions that open Work.

### Data model

`users/{uid}` or `users/{uid}/settings`:

```
onboarding: { job: "talk" | "document" | "meetings" | "skipped", at }
lifeContext: "work" | "personal" | "both" | null   // examples only, not a data plane
```

`POST /settings/onboarding`. GET included in an existing settings bundle or Home payload.

### Services & infrastructure

- Gateway settings routes (locale already exists). Add onboarding.
- Home `homePlan` + digest unchanged otherwise.
- Optional: documents indexing count for a status row — `GET /documents` already; Home can call it. Don't add a new service.

### Interface

- Full-screen first-run if `onboarding` missing. Three jobs + skip. Skip writes `skipped`.
- Job `talk`: focus composer (on-page on mobile). Job `document`: open file/camera sheet (Documents upload). Job `meetings`: copy about listen vs transcript + Connect Google (P5 exception).
- Home: starter chips when digest quiet and no in-progress work.
- Companion composer **on the Home main column below `lg`**, not only FAB. FAB remains on Watchers/You.
- Language offer: after first win or You — move off the first paint if it fights the job screen. If locale already set, never show.
- Welcome bubble: job-aware one-liner.

### Requirements met

Design §8.3–8.4, P3, P5. NN/g: starting verb, not blank prompt.

### How it is proven

- New signup → job screen → skip → Home with chips, no TRACE.
- Job document → upload path without visiting Profile.
- Mobile Home: type a message without opening the FAB.
- Returning user: no job screen.

### What could go wrong

- Job screen every refresh if POST fails — treat GET missing as show, POST must succeed before navigate.
- Asking for Google on job 1 — forbidden. Only job 3.

**Files (Cut 2)**

| File | Change |
|---|---|
| `services/gateway/src/routes/` settings | GET/POST onboarding |
| `web/src/app/screens/Home.tsx` | Job screen, chips, mobile composer, no TRACE (already Cut 0) |
| `web/src/app/LanguageChoice.tsx` | After first win / You |
| `web/src/app/CompanionPanel.tsx` | Welcome line from `onboarding.job` |
| `web/src/locales/en.json` (+ 6) | Job strings |

---

## Cut 3 — Watchers create

### Goal

A user can create a standing instruction that **fires** on a schedule we can observe, pauses for review, and counts against allowance **before** the run. No inbox-Gmail. No silent calendar writes from a watcher.

### Data model

`users/{uid}/watchers/{id}`:

```
name, trigger, ceiling, running, lastRunAt   // existing
instruction: string          // "When X, draft Y"
triggerKind: "schedule" | "session_ended"
intervalMinutes: number      // for schedule; min 60 in v3.5 (don't offer 5-minute hammering)
nextRunAt: Timestamp
```

Project index `watcherSchedule/{uid}_{watcherId}`: `{ uid, watcherId, nextRunAt, running }`. Deleted when watcher deleted; `running: false` removes from due query or keeps with far-future `nextRunAt`.

`POST /watchers` body: `{ name, instruction, triggerKind, intervalMinutes?, ceiling }`. Server sets `nextRunAt = now + interval` (schedule) or no schedule row (session_ended — gateway already publishes `session-ended`; watcher-runtime consumes and matches watchers with that kind).

`WatcherRun` writers: `state`, `detail`, `sessionId` (the work item created or `companion`), quota block state `blocked`.

### Services & infrastructure

- Gateway `POST /watchers`, `DELETE` optional later. Create writes Firestore + schedule index.
- Terraform: Cloud Scheduler `watcher-due` every 5 min → watcher-runtime `/events/due` with OIDC (copy digest-due pattern). **Do not** create per-user Scheduler jobs.
- watcher-runtime `/events/due`: query `watcherSchedule` where `nextRunAt <= now` and `running == true`, limit 50, publish `watcher-trigger` for each, set `nextRunAt += interval` **after** enqueue (so a crash retries; idempotency: `runId = watcherId + nextRunAt_iso` stored).
- `execute_run`: `check(WATCHER_RUNS)` first; on confirm/clarify → `awaiting_review` (already); **remove the fake `"done"` after planning** if it currently claims done without effect — v3.5 done means "planned, waiting" (`awaiting_review`) unless ceiling is draft_only and the only output is an artifact. **Chosen:** successful plan without invoke → `awaiting_review` + artifact of the draft (reuse 1b artifact writer from runtime via gateway API or duplicate markdown write in runtime — **prefer publish to gateway internal** or write artifacts from gateway only). Simplest: runtime writes run row; Today digest links to Watchers; user opens and confirms in the companion. Artifact optional in Cut 3 if 1b helper is importable. **Minimum:** run appears in digest as awaiting.
- Session-ended: watcher-runtime already may listen; if not, subscribe the same way as profile-synthesizer. Filter `triggerKind == session_ended`.

**Terraform (Cut 3)** — copy the digest job, do not invent a new auth pattern:

```
# next to google_cloud_scheduler_job.digest
resource "google_cloud_scheduler_job" "watcher_due" {
  name     = "watcher-due-${var.env}"
  schedule = "*/5 * * * *"
  time_zone = "Etc/UTC"   # due-scan is not a morning product; UTC is fine
  pubsub_target {
    topic_name = google_pubsub_topic.events["watcher-due"].id
    data = base64encode(jsonencode({ sweep = true }))
  }
}
```

Add topic `watcher-due` to the events map (same shape as `digest-due` → watcher-runtime `/events/due`). That path queries `watcherSchedule` and publishes **existing** `watcher-trigger` per row. Two hops, clear names — digest already uses this pattern (`digest-due` → `/events/digest`).

Firestore index (Terraform `google_firestore_index`): collection `watcherSchedule`, fields `running` ASC, `nextRunAt` ASC. Query: `where running==true`, `where nextRunAt<=now`, `limit 50`.

**IAM for the index collection:** watcher-runtime SA needs read/write on `watcherSchedule/{id}`. Gateway SA needs write on create/pause/delete. This collection is **pointers only** (uid, watcherId, timestamps). Still: do not put instruction text here.

Pause: existing pause handler must also set `watcherSchedule` `running: false` or delete the index row. Resume: rewrite `nextRunAt = now + interval`.

**Files (Cut 3)**

| File | Change |
|---|---|
| `services/contracts/src/index.ts` | Watcher create body; optional `instruction`, `triggerKind` on WatcherSchema |
| `services/gateway/src/repos/watchers.ts` | POST, schedule index write |
| `services/gateway/src/index.ts` | Route |
| `services/gateway/src/watchers.test.ts` | Create, floor 60, pause clears due |
| `services/watcher-runtime/app/` | `/events/due`, quota before plan, stop fake done |
| `infra/modules/stack/main.tf` | Topic, scheduler, index |
| `web/src/app/screens/Watchers.tsx` | Create flow + ConfirmGate |
| `web/src/locales/*.json` | Create copy; **no Gmail** |

### Interface

- Empty state + **Create a watcher**.
- Flow: textarea instruction → companion proposes name, ceiling (`send_after_review` default), schedule (daily/hourly) → ConfirmGate → POST.
- Copy: cannot watch Gmail. Triggers: "every weekday morning", "when a piece of work ends".
- List: last run → `/app/sessions/:sessionId` if present.
- Pause already works.

### Requirements met

Design §8.6, P7, §2.5.2–3. Meter watcher runs before spend.

### How it is proven

- Create → schedule index row → due endpoint in emulator/time travel → run `awaiting_review` → digest shows it (Cut 0 fields).
- Quota 0: run `blocked`, no orchestrator call.
- No Gmail string in the create UI (grep the locale keys).
- Scheduler Terraform plan shows **one** job, not N.
- Guard: no collectionGroup.

### What could go wrong

- Due query needs a composite index on `watcherSchedule`. Add to Terraform firestore indexes.
- `intervalMinutes: 5` as a denial-of-wallet. Floor at 60.
- Publishing without OIDC → 401. Copy digest job auth.

---

## Cut 4 — Information architecture

### Goal

Four primary destinations. Profile is not the product. Agents are not a tab. Specialists start work.

### Data model

None. Redirects only.

### Services & infrastructure

`web/src/App.tsx` routes:

| Path | Screen |
|---|---|
| `/app` | Today (`Home.tsx`) |
| `/app/work` | list (`Sessions.tsx` retitled) |
| `/app/work/:id` | `SessionDetail` + canvas column behaviour as design §8.5 |
| `/app/watchers` | unchanged |
| `/app/you` | former Profile |
| `/app/you/running` | Agents + Specialists |
| `/app/artifacts/:id` | Canvas (from Cut 0) |
| `/app/sessions`, `/app/sessions/:id`, `/app/profile`, `/app/agents` | `<Navigate replace>` |

`nav.ts`: four items. TabBar/Sidebar consume it.

Search: filter `listSessions` + `listWatchers` + `listDocuments` client-side on Work top bar. No kbd until `useEffect` keydown `/` focuses the input **and** the input filters.

Recents: `sessions.slice(0,5)` from API.

Specialists: `onClick` → `POST /sessions` + seed message ("Help me read a document I will upload" / "Note my next meeting" / "Draft a layout" / "Find out about …") + navigate. Researcher can stay a prompt.

You page section order as design §8.7. Plan & usage at top **with billing slot empty until Cut 5** (Upgrade button hidden or "Coming" — **prefer hide** so we don't 404). After Cut 5, wire it.

Canvas default-open when `GET /artifacts?sessionId=` — add query on list endpoint if missing (`sessionId` filter in `listArtifacts`).

**Files (Cut 4)**

| File | Change |
|---|---|
| `web/src/App.tsx` | Routes + redirects |
| `web/src/app/nav.ts` | Four items |
| `web/src/app/TabBar.tsx` `Sidebar.tsx` | Consume nav |
| `web/src/app/screens/Profile.tsx` | Section order; may rename file later |
| `web/src/app/screens/Agents.tsx` `Specialists.tsx` | Nested under You; specialist starts work |
| `web/src/app/Digest.tsx` | `/app/work/:id` |
| `web/src/locales/*.json` | `nav.work`, `nav.you`, `nav.today` |
| Landing hero support | Design §11.2 (or with Cut 5) |
| `services/gateway/src/repos/artifacts.ts` | Filter by sessionId |

### Interface

- Today composer (from Cut 2).
- Work: object beside conversation when artifact exists (`xl` layout already). Below `xl`, tabs Chat | Work as now, but Work selected when artifact count > 0.
- What's running: collapsed by default.

### Requirements met

Design §8.2, P3, P10.

### How it is proven

- Old bookmarks redirect.
- Phone: four tabs, sign-out in header menu and You.
- Specialist click produces a session (Cut 1).
- No fifth Agents tab.

### What could go wrong

- Deep links in digest still pointing at `/app/sessions` — grep and replace.
- i18n keys `nav.sessions` → `nav.work`; update all seven locales (guard `check-locales.py`).

---

## Cut 5 — Billing

### Goal

A Firebase user can pay for Plus in Stripe test mode and see `usage.label` become Plus without a manual Firestore edit. They can cancel in the Customer Portal and return to Free at period end. Marketing table matches `libs/metering`.

### Data model

`subscriptions/{uid}`:

```
tier: "free" | "plus" | "team" | "max"
status: "free" | "active" | "trialing" | "past_due" | "canceled" | "unpaid"
stripeCustomerId: string | null
stripeSubscriptionId: string | null
currentPeriodEnd: Timestamp | null
priceLookupKey: string | null
```

`plan_for(tier)` unchanged. **Paid entitlements** if `status ∈ {active, trialing, past_due}` **and** `tier !== free`. `canceled` / `unpaid` / missing → Free. `past_due` keeps Plus during Smart Retries (design §10.1).

`stripeEvents/{eventId}`: `{ at }` unique id = Stripe `event.id`.

`documents` meter: add to Python `Meter` + `Plan` + contracts `METERS` + gateway `usage.ts` + `check-plan-table.py`. Librarian/gateway ingest: count current docs; refuse at limit with a human message.

### Services & infrastructure

- Secret Manager: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Gateway IAM accessor. Terraform `secret_env_vars`.
- Env: `STRIPE_PRICE_PLUS` (price id `price_...`) or lookup key `plus` resolved server-side via `prices.list({ lookup_keys: ["plus"] })` — **prefer lookup key** so test/live differ only by secret.
- `POST /api/billing/checkout` — auth required; create Customer if none (`metadata.firebaseUid`); session `mode: subscription`, `line_items: [{ price, quantity: 1 }]`, `client_reference_id: uid`, `subscription_data.metadata.firebaseUid`, `success_url`, `cancel_url`, `currency` implicit from price (GBP).
- `POST /api/billing/portal` — `return_url: /app/you`.
- `POST /api/billing/webhook` — raw body. Handlers: `customer.subscription.created|updated|deleted` (refetch subscription; map price → tier; write Firestore). `checkout.session.completed` links customer id if subscription events race. `invoice.payment_failed` log only. Ignore the rest with 200.
- Map price: only Plus in v3.5. Unknown price → log error, **do not** upgrade.
- Web: `Usage` + You Plan card: Upgrade → checkout redirect; Manage plan → portal. Poll on `?billing=ok`.
- Landing `pricing.tsx`: **generated from a JSON export** of plans (script `scripts/export-plan-table.ts` or Python print). Guard reads that file. Free/Plus only on the page; Team = "Talk to us"; Max omitted. GBP. No trial language.
- Stripe Tax: Dashboard threshold monitoring; `automatic_tax` optional later. Not blocking.
- Customer Portal: enable in Dashboard, allow cancel at period end, allow price change **none** (only Plus). Payment method update on.

**Express gotcha:** `app.use(express.json())` is at `index.ts` line 43, **before** `/api` is mounted. The webhook **cannot** live on `api.post` after that parser. Register on `app` **above** line 43:

```
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);
app.use(express.json({ limit: "1mb" }));
```

`stripeWebhook` uses `req.body` as a `Buffer`. `constructEvent(req.body, sig, secret)`. Pin the Stripe SDK API version in code (`stripe({ apiVersion: "2026-..." })` — use whatever the installed `stripe` package's current default is, **explicitly**, so a minor bump cannot reinterpret events).

Stripe CLI: `stripe listen --forward-to localhost:8080/api/billing/webhook` (gateway port, not Vite).

#### Event → Firestore map

| Event | Action |
|---|---|
| `checkout.session.completed` | Upsert `stripeCustomerId` from session.customer; do **not** set `tier` here if subscription events also fire (prefer subscription as source of paid state). Customer mapping only. |
| `customer.subscription.created` | `subscriptions.retrieve(id)`; map lookup_key/`price` → plus; set status, period end, ids, **tier** |
| `customer.subscription.updated` | Same retrieve. If `cancel_at_period_end`, keep tier, set a flag for UI "cancels on {date}" |
| `customer.subscription.deleted` | `tier: free`, `status: canceled`, keep customer id |
| `invoice.payment_failed` | Log `uid` from metadata; no lockout |
| Other | 200, no write |

Uid resolution order: `subscription.metadata.firebaseUid` → `client_reference_id` on checkout session (retrieve if needed) → `customer.metadata.firebaseUid`. If none: **500** so Stripe retries (or 200 + error metric if the customer is not ours). Never create a subscription doc under a guessed uid.

`plan_for` in connector-gateway reads `subscriptions/{uid}.tier` today. It must also respect `status`: if webhook wrote `tier: plus` and later `status: unpaid`, `plan_for` returns Free. **That is a connector-gateway / metering change** in the same cut as the webhook, or Plus-past-due users keep generating after Stripe gives up. Add `effective_tier(doc) -> Tier` next to `plan_for`.

#### Documents meter (same cut as billing unification)

`Meter.DOCUMENTS = "documents"` in Python. Allowances: Free 5, Plus 200, Team/Max `None`. Count is **current stored documents**, not monthly spend — `check` still works if `used` is list count at ingest time. Do not increment a monthly counter that never decrements on delete; **count the collection** at upload. Delete frees a slot.

`check-plan-table.py`: parse `web/src/lib/plans.json` (generated) **and** `usage.ts` **and** `METERS` in contracts. Landing imports `plans.json`.

**Files (Cut 5)**

| File | Change |
|---|---|
| `infra/modules/stack/secrets.tf` | Two secrets, gateway accessor |
| `infra/modules/stack/main.tf` | `secret_env_vars` on gateway |
| `services/gateway/src/billing.ts` | **New** checkout, portal, webhook, idempotency |
| `services/gateway/src/billing.test.ts` | Signature, replay, unknown price, missing uid |
| `services/gateway/src/index.ts` | Raw webhook **before** json(); authenticated billing routes on `api` |
| `services/gateway/package.json` | `stripe` dependency; `check-image-deps` |
| `libs/metering/...` | `documents` meter; `effective_tier` |
| `services/connector-gateway` | Use `effective_tier` |
| `services/contracts/src/index.ts` | METERS + optional Usage status |
| `services/gateway/src/repos/usage.ts` | Mirror |
| Librarian or gateway ingest | Refuse at 5/200 |
| `scripts/check-plan-table.py` | Marketing JSON |
| `scripts/export-plan-table.py` | Writes `web/src/lib/plans.json` |
| `web/src/components/blocks/pricing.tsx` | Import JSON |
| `web/src/app/Usage.tsx` | Upgrade / Manage |
| You / Profile | Plan card |
| Home | `?billing=ok` poll if they land there |

Dashboard (manual, owner): Product "AllTheWay Plus", price £18/month recurring, lookup_key `plus`, GBP. Webhook endpoint = **gateway** URL, events listed above. Customer Portal config. Smart Retries on. **No Team/Max prices.**

### Interface

- Paywall strings as design §10.4.
- Near-limit Usage: Upgrade.
- Voice refuse (1b) copy includes Upgrade if Free.

### Requirements met

Design §10. Open decision 5 closed. P6, P9.

### How it is proven

- Stripe test `4242`: checkout → webhook → `GET /usage` `label === "Plus"`.
- Portal cancel + test clock → `tier` Free, `status` canceled.
- Replay same `event.id` → one write.
- Bad signature → 400, no write.
- Success URL without webhook (kill handler) → UI does not show Plus.
- `check-plan-table.py` fails if landing JSON drifts.
- Documents: sixth upload on Free refused.

### What could go wrong

- Webhook on Hosting URL → timeout/signature issues. Gateway URL only.
- Fulfilling from `checkout.session.completed` metadata only, then `subscription.updated` overwrites with empty metadata → user dropped to Free. **Refetch + subscription_data.metadata.**
- Putting secret in `VITE_*`. Forbidden.
- Team waitlist user pays Plus and expects sharing — copy must say sharing is Team, not Plus.

---

## Cut 6 — Meetings as a job

### Goal

Job 3 is completable: consent hydrates, commitments are approvable, empty state tells the bot-free story, extend is reachable when the backend says the meeting is about to cap.

### Data model

None new. Scribe records already exist.

### Services & infrastructure

- `GET /settings/meetings` from Cut 0.
- Mount `CommitmentCard`; `confirmCommitment` already in `data.ts`. Confirm path must hit the same confirm/act rules: a commitment that implies calendar → 1b `actOnConfirm` or a dedicated "create event from commitment" that still uses `invoke(confirmed=true)`.
- `extendMeeting`: mount `DurationNotice` when API says so (read meeting payload for remaining minutes).
- Opt-out: reload list after POST (bug: currently no reload).

### Interface

- You → Meetings (and Today job 3).
- Empty: "It listens on calls you host, or reads the transcript after. It cannot speak. No bot in the participant list unless you opted into live listen."
- Insights: hide meter row on Free/Plus (0 allowance) with one line; don't show 0/0 bar.

### Requirements met

Design §8.7 meetings, FR-C2–C4, job C.

### How it is proven

- Enable, refresh, checkbox still on.
- Seed/fake commitment → confirm → calendar event if 1b wired and connected.
- Opt-out persists on reload.

### What could go wrong

- Treating live Media API as in-scope. It is not. Fail correctly as today.
- Auto-confirming commitments. Forbidden.

**Files (Cut 6):** `web/src/app/Meetings.tsx`, `CommitmentCard` (find or create), `DurationNotice`, `Usage.tsx` hide insights bar, locale strings. Reuse `act.ts` if the commitment is a calendar create — pass through ConfirmGate rather than a third Yes.

---

## Cut 7 — Composer drop and citations

### Goal

Job B is one gesture: drop/file/camera → upload → turn that asks about the densest part. Grounded claims show a citation chip that opens the passage, not only a trace line.

### Data model

Turn events: optional `citations: { documentId, chunkId, page, title }[]` on `done` / step. If the orchestrator already sends passages in the trace, **promote** them to a typed event in `@alltheway/contracts` rather than parsing prose.

### Services & infrastructure

- Companion `acceptDrop`: after successful upload, `send(\`I've added ${name}. Start with the densest or most consequential part and cite it.\`)`.
- Same from Documents "ask about this" button (new, next to delete).
- Orchestrator `grounding.py`: attach citation ids on the closing payload. Gateway maps to SSE `citation` events.
- UI: chip → modal/sheet with passage text already retrieved (do not re-query another user). Passage in the event must be the same text that was in the prompt — FR-D2.

### Interface

- Composer drop note is not "now ask me".
- Citation chip on the agent bubble.

### Requirements met

Design §9.1 composer drop, R3, FR-D2 visible.

### How it is proven

- Drop PDF → one user message + one turn, no extra click.
- Grounded answer without citation fails a unit test on a fixture contract.
- Blocked document: upload error, no turn.

### What could go wrong

- Sending the whole PDF in the message as well as retrieving — duplicate cost. Upload then retrieve only.
- Citation opening another user's chunk — still path-scoped; don't pass `uid` from the client.

**Files (Cut 7)**

| File | Change |
|---|---|
| `services/contracts/src/index.ts` | `kind: "citation"` event or `done.citations` |
| `services/orchestrator` `grounding.py` | Typed citation ids on close |
| `services/gateway/src/orchestrator.ts` | SSE map |
| `web/src/app/use-turn.ts` | Collect citations |
| `web/src/app/CompanionPanel.tsx` | `acceptDrop` auto-send; chips |
| `web/src/app/Documents.tsx` | "Ask about this" |
| `web/src/app/CitationChip.tsx` | **New** sheet |

Add a contract test: fixture turn with a grounded claim and empty citations → fail.

---

## 4. Copy, landing, locales

In Cut 0/4/5 as strings change. Voice: calm, specific, adult (design §11). No "reimagine." No "just." Confirmations name the object.

### 4.1 Landing (Cut 0 honesty + Cut 5 numbers)

**Support line (Cut 4):** "Talk it through, bring the document, keep the meeting. It shows the plan before it acts — and you can see what it has learned."

**Hero CTA:** Start free → `/signup`. Secondary: scroll to a real moment (`#voice` only if that id still exists and is a product clip).

**Pricing rows (must match meter after Cut 5 export):**

| Tier | Price | Features (public) | CTA |
|---|---|---|---|
| Free | £0 | 30 voice min, 50 watcher runs, 200 connector calls, 5 documents, 20 images, no live meeting insights, no sharing | Start free → `/signup` |
| Plus | £18/mo | 600 min, 1000 runs, 5000 calls, 200 documents, 500 images, 20s draft video | Start free (marketing) / Upgrade (in-app Checkout) |
| Team | — | Waitlist. Do not list SSO. "Sharing and live meeting checks — talk to us." | `/contact` mailto |
| Max | omitted | — | — |

Forbidden strings: "Start free trial", "No Watchers", "$18", "Custom" as if Plus weren't a price, "unlimited" on Free.

**Igbo footnote** near voice/marketing language count: "Live audio follows Google's language list; Igbo is not on it."

**Meetings empty:** "It listens on calls you host, or reads the transcript after. It cannot speak in the room."

### 4.2 In-app

| Surface | Copy |
|---|---|
| First-run title | "What should we start with?" |
| Job 1 | "Talk something through" |
| Job 2 | "Read a file or photo" |
| Job 3 | "Catch me up after meetings" |
| Skip | "Skip for now" |
| Watchers empty | "It watches something and stops before anything irreversible." |
| Watchers create hint | "Time, a calendar you connected, or when a piece of work ends. It cannot watch your Gmail inbox." |
| Watcher created | "Watcher '{name}' is running — it will draft, not send." |
| Near-limit | "12 minutes left this month. Upgrade to Plus for 600." |
| Billing poll | "Updating your plan…" then success or "Refresh if this hasn't changed in a few seconds." |
| Share on Free/Plus | Existing human refusal + "Sharing is on Team. Team isn't self-serve yet — use Contact." |

`check-locales.py` must pass. Machine drafts may keep English-identical values; do not ship unreviewed Yoruba as "done."

---

## 5. Infra checklist (all cuts)

| Change | Cut |
|---|---|
| None | 0, 2, 4, 6, 7 (mostly) |
| `CONNECTOR_GATEWAY_URL` + invoker on gateway SA | 1b |
| Firestore index `watcherSchedule` `nextRunAt`+`running` | 3 |
| Scheduler `watcher-due` | 3 |
| Secrets Stripe + gateway env | 5 |
| Documents meter (code only; no new GCP) | 5 |

Gateway timeout 3600s already for voice. Webhook is short; no change.

---

## 6. Sequencing, parallelism, estimate

```
0 Honesty ─────────────────────────────┐
1 Work exists ──► 1b One action ───────┼──► 2 Today
                 1b ──► 3 Watchers ────┤
1 ──► 4 IA (after routes exist)        │
1b + 4 ──► 5 Billing                   │
0 + 6 Meetings (GET already in 0)      │
1 + 7 Composer drop                    ┘
```

**Do not start 5 before 1.** Do not start 3 create-CTA before 0 empty state. **Do not start 1b before 1** (confirm needs a session document).

**PR boundaries.** One cut per PR when possible. Cut 1b's Terraform (invoker graph) **must not** merge after the gateway code that calls connector-gateway, or prod Yes 403s. Prefer: infra PR first (env + IAM, unused), then code PR; or one PR with apply before traffic. New test files must be listed in the package's test glob (`scripts/check-tests-listed.py`). New `stripe` / Python deps must land in the service Dockerfile in the **same commit** (`check-image-deps.py`).

| Cut | Calendar (focused) |
|---|---|
| 0 | 2–3 days |
| 1 | 2–3 days |
| 1b | 4–6 days (IAM, A2A, idempotency) |
| 2 | 2–3 days |
| 3 | 4–5 days |
| 4 | 2–3 days |
| 5 | 4–6 days (Stripe Dashboard + webhook) |
| 6 | 1–2 days |
| 7 | 2–3 days |
| **Total** | **~4–6 weeks** one engineer; 3 if 3 ∥ 5 after 1b |

---

## 7. Proof of the version (release gate)

A stranger account, production-like, no seed:

1. Signup does not crash.
2. Picks "talk it through", sends a sentence, sees it on Work the next day (or after reload).
3. Asks to put something on the calendar, confirms, sees the event **or** a connect instruction — never silent success.
4. Drops a PDF, gets a cited answer.
5. Creates a daily watcher, due job produces `awaiting_review` in Today.
6. Pays Plus in test mode, usage label changes; cancels, returns to Free at period end.
7. Phone: sign out. No dead New/Bell/Recents/TRACE.
8. `npm run guards` green. Tenant isolation still fails if someone adds `collectionGroup`.

If 3 or 5 fails, it is not v3.5.

### 7.1 Success metrics (instrument, don't decorate)

From the design §14. No analytics vendor required in v3.5: structured logs + a weekly manual count during dogfood is enough. If a later cut adds a table, it is not this version's pillar.

| Metric | How to see it |
|---|---|
| Fresh account → persisted work | Emulator/prod: `GET /sessions` after first send |
| Dead-click rate | Cut 0 proof: every primary control either works or is gone |
| Time to first confirmed action | Cut 1b calendar test |
| Checkout completion | Stripe Dashboard test-mode conversion |
| Plus among 80% voice / watcher creators | Usage + Firestore after Cut 5 |
| 7-day return | Firebase Auth last-refresh (directional) |
| Support theme | "nothing happened" should die after Cut 0–1b |

---

## 8. Explicitly not in this plan

Matches design §12, plus:

- Wiring Gmail send on Yes
- Watchers that auto-create calendar events
- Stripe Team/Max Checkout
- Annual plans, Metronome, Entitlements as runtime gate
- Meet Media API enrolment
- Gemma, Veo UI, image regen
- Native apps
- Reviewed translations

---

## 9. What this plan needs from the owner

Confirm the six defaults in §0, or invert them before the matching cut. Especially **1b Calendar-only** and **Team waitlist** — they change Stripe objects and the confirm allow-list.

Payment provider is not a question. Stripe is the work in Cut 5.

**Owner-only before Cut 5 ships live (not in Terraform):**

1. Stripe account (test, then live) in GBP.
2. Product + Price lookup_key `plus`, £18/month.
3. Customer Portal: subscriptions, cancel at period end, payment method update; no plan-switching UI until Team/Max exist.
4. Webhook endpoint = Cloud Run **gateway** URL + `/api/billing/webhook`; signing secret into Secret Manager.
5. Smart Retries on. Stripe Tax monitoring on. No trial on the Plus price.
6. He commits and pushes; this plan does not.

**Handover to the implementing agent:** start at Cut 0. Do not open a new pillar. Do not restyle the brand. Do not wire Gmail send because it is "already there." Verify each cut's proof list by running it.

---

## Sources

**Code.** Session/Watcher schemas: `services/contracts/src/index.ts`. Digest mismatch: `repos/digest.ts` vs `watcher-runtime/app/runtime.py` (`state`/`detail` vs `status`/`summary`). Calendar tool: `connectors/google_calendar_server.py`. Voice usage after close: `voice/relay.ts`. Session end: `gateway/src/index.ts`. Decision is ledger-only: same file `POST /sessions/:id/decision`. Connector invoke: `connector-gateway/app/a2a_executor.py` data part + `context.tenant`. Invoker graph omits gateway: `infra/modules/stack/main.tf`. `I18nProvider` only in `AppLayout.tsx`. `main.tsx` has no i18n wrap. `express.json` at gateway `index.ts:43`. Pricing lie: `web/src/components/blocks/pricing.tsx`. Companion confirm chips: `CompanionPanel.tsx` `send(option)`.

**Firestore parent docs.** [Console italics / queries skip missing parents](https://stackoverflow.com/questions/70539221/firestore-query-returns-no-documents-even-though-they-are-shown-in-the-console-i).

**Stripe.** [Webhook signature + raw body](https://docs.stripe.com/webhooks); [Checkout subscriptions](https://docs.stripe.com/billing/subscriptions/build-subscriptions); [Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal); `subscription_data.metadata` vs session metadata ([common miss](https://stackoverflow.com/questions/77988690/stripe-passing-metadata-from-create-checkout-session-to-webhook)); refetch-on-event ([idempotency pattern](https://theroadtoenterprise.com/blog/stripe-webhook-idempotency-production)).

**Scheduling.** One cron + application due-index, not per-user Scheduler jobs ([Cloud Tasks + Firestore due queue](https://devguide.dev/blog/cloud-tasks-firestore-durable-queue); [Firebase scheduled functions guidance](https://stackoverflow.com/questions/56074188/how-to-create-cron-jobs-in-firebase-programmatically)).

**Product design.** [AllTheWay-v3.5-Product-Design.md](AllTheWay-v3.5-Product-Design.md). Safety bar: [AllTheWay-v3-Implementation-Plan.md](AllTheWay-v3-Implementation-Plan.md) §1.

---

*A cut is done when its "How it is proven" has been run, not when the types line up. Cut 1b is the one that turns this from a metered planner into something a person might pay for; Cuts 0 and 1 are what stop them leaving before they see it.*
