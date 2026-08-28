# AllTheWay as a planner and partner

**Status:** Accepted 2026-08-28
**Household:** one adult account. Children and a partner exist as people and commitments in her world, not as logins.
**Supersedes:** nothing. Complements Product Manifest v3 (work artifacts, meetings, Studio) by making **Today** the day she lives, not a Studio lobby.

## Recommendation

Keep five destinations. Do not add a sixth Life app. Rebuild Today so the first thing she sees is the **next twelve hours** of her life — school run, 9–5, kids’ activities, church — with **leave-now** as the reminder that matters. Google Calendar is the clock. AllTheWay is the system of record for *anticipation*: who, where, when to leave, what is waiting on her.

The companion remains the planner. Confirm-before-act stays. Watchers propose; they do not add calendar events.

## Why this, not a to-do app

Mothers’ physical chores shrink with income and hours; the mental load does not (Weeks, Ruppanner, Haupt & Gelbgiser, 2025). The work that sticks is anticipate → identify options → decide → monitor (Daminger). Cozi stores what she types. Motion rearranges the calendar. AllTheWay already has confirm-before-act, Watchers, a morning digest, voice, and Google Calendar read/write. It did not *show the day* or say “leave in 12 minutes.”

Family “management” apps fail when she becomes the person who updates five tools. Capture must be cheaper than memory.

## Dominant trade-off

We give up a shared family calendar and an autopilot scheduler. We gain a product that can hold children-adjacent logistics without COPPA, without a second parent’s login, and without the calendar rearranging itself.

## What we refuse

| Product | Why not us |
|---|---|
| Cozi / TimeTree / FamilyWall | Shared colour-coded household grid she has to fill |
| Motion | Silent reshuffle. Already rejected for Watcher calendar writes |
| Reclaim clone | We may *suggest* a work block; we do not silently defend it |
| Orgo / Carpoolio | Multi-family carpool OS. Out until household sharing exists |
| Church CMS | Church is a **hat**, not a product we build |
| Kids’ accounts | No COPPA surface. School paper is *her* document |

## Glossary (locked nouns)

- **Today** — the morning surface. Do not rename to Home.
- **Work** — collaborative sessions and plans, not her job calendar.
- **Person** — someone in her life. No login.
- **Place** — school, office, church; used to compute leave time.
- **Rhythm** — recurring logistics, distinct from a Google event.
- **Commitment** — a dated thing that may also live on Google Calendar.
- **Reminder** — a clock that fires for her. Not a Watcher.
- **Waiting on you** — decisions, clarify gates, proposed commitments.
- **Hat** — `work` | `home` | `church`. Filters the day. Never three products.

## Quality attributes (ranked)

1. A missed pickup is worse than a missed digest. Leave-now within about a minute of due time.
2. No surprise writes involving children or calendar.
3. Calm: leave-now + waiting-on-you. Quiet hours per hat.
4. Capture in one gesture (photo, voice, “soccer Thursday 4”).
5. Cost: calendar list is a connector read; reminders are Scheduler, not Live API.

## Current state (verified)

Today was greeting + Studio/plan/file cards + an agent digest. `lifeContext` only reordered first-run jobs. Push existed (FCM) but opt-in sat under You → Shared with you, and the only send was the 07:00 digest when something awaited review. Calendar `list_events` already worked for voice and typed lookups. Watchers could not fire more often than 60 minutes. iOS Web Push only after Add to Home Screen.

## Design

```
Today
  next leave line
  next 12 hours (calendar + rhythms)
  waiting on you (digest + proposed commitments)
  in-app tray (due reminders)
  continue a plan / overnight watchers
  capture cards (plan, remind, photo) — Studio stays in nav
```

Google Calendar remains system of record for time. Writes still go through confirm (`create_event`). Rhythms generate leave reminders without 180 todos.

Hats filter the timeline and which reminders fire. They do not hide Work sessions.

### Companion escalation

1. Show the day — no model. `GET /home` includes the next 12 hours.
2. Pack tomorrow — one orchestrator turn, confirm to move or remind.
3. Watchers — when a file is indexed, **propose** commitments; do not add them. Gmail inbox watch stays later (CASA).
4. No multi-agent swarm for a school run.

### Reminders and push

- Chrome/Android + desktop: existing FCM.
- iOS: only a Home Screen PWA. Copy must say so; never fail silently.
- Due scan every minute on `reminderDue` (pointers only, like `watcherSchedule`). Five-minute watcher scan is unchanged.
- In-app tray always works with the tab open.
- Lock-screen copy: “Leave for pickup in 12 minutes.” Never “Your digest is ready.”

### Data

Under `users/{uid}/`: `people`, `places`, `rhythms`, `reminders`, `proposedCommitments`.

Project pointer: `reminderDue/{uid}_{reminderId}` — uid, reminderId, fireAt. No instruction text.

Children’s names in her account are ordinary PII. No child profile that looks like an account. Retention follows user deletion.

### Partner later (Phase E, not this delivery)

Share a **view** of a day or a reminder (existing artifact shares). Not a household OS. New ADR when she asks.

## Fitness function

She can answer “when do I leave for pickup?” from Today without opening Google Calendar.

**Revisit if:** a second adult needs a login; leave-now miss rate exceeds a digest miss in support; she asks for Motion-style reshuffle.

## Phasing

| Phase | What ships |
|---|---|
| A | Next 12 hours on Today from `list_events`; demote Studio cards; push opt-in on Today |
| B | Reminder entity, minute due-scan, in-app tray, FCM leave-now |
| C | People, places, rhythms (school run / church) |
| D | Photo/file → proposed commitments; document-indexed watchers propose only |
| E | Partner view-share (later ADR) |

## Decision

Approved shape: Today-as-day, Google as clock, reminders as leave-now, solo adult. Not Cozi inside AllTheWay.
