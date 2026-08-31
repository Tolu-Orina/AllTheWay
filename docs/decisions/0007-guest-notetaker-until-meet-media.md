# Guest notetaker until Meet Media enrolment

**Status:** accepted · **Date:** 2026-08-31 · **Phase:** meetings (capture ladder)

## Decision

Until this Cloud project can complete a real Meet Media (Tier 2) session, AllTheWay may send an **opt-in, labelled, mute, never-speaking guest notetaker** into a call the host admits. The notetaker is a **capture rung** (Tier 2.5), not a second product. The Chrome extension remains the **default** live path. When `connectTier2` succeeds in production, the **Meet** bot is retired.

This reverses the locked “no guest bot” row in the PRD, FR-C7’s “not join as a guest (Won’t)” as applied to *labelled admitted* bots, and v3.5’s “no meeting bot that joins as a guest.” An **unannounced** bot remains a Won’t.

Normative plan: [AllTheWay-Meeting-Joiner-Plan.md](../AllTheWay-Meeting-Joiner-Plan.md).

## Why we refused this before

The trust posture was written as a commercial asset, not a slogan:

- Meet Media is receive-only and shows Google’s own initiation dialog; a bot is an extra participant.
- Granola is paid for *discretion* (nothing in the list). Fathom’s default bot is the complaint they upsell away from.
- FR-C7: if Meet refuses (underage, E2E, watermark), we fall back or say no — we do not sneak in as a guest.

That reasoning is still true. What changed is **availability**, not the preference.

## Why it is allowed now

Meet Media remains Developer Preview. Official constraint: the Cloud project, the OAuth principal, **and every participant in the conference** must be enrolled. Restricted media scopes then require OAuth verification and CASA if we store or transmit conference media. None of that is a date we own. `connectTier2` still throws a recorded refusal.

Meanwhile:

- Mixed `tabCapture` cannot name speakers (live transcribe has no diarization).
- Zoom desktop and Teams desktop are out of reach of the extension.
- Platforms spent 2026 making *covert* bots expensive (Meet high-scrutiny knock queue, default deny; Teams `RequireApprovalWhenDetected`; Zoom OBF from 2 Mar 2026). A labelled, host-admitted bot is the join the platforms now expect, not a loophole.

So C is a **stopgap with an off-ramp**, not a new identity.

## Constraints that travel with the decision

- Per-meeting confirm. No calendar auto-join in the first slice.
- Bot-hours are **Max only**.
- Display name is obviously AllTheWay. Camera off, mic muted, no uplink audio, no TTS. One disclosure chat line at most.
- Same scribe / screening / insights / confirm gate as tab capture.
- Buy join infrastructure; do not own a Playwright Meet client. Vendor (Recall EU vs alternative) waits on a finance review; do not sign until that lands.
- Meet bot dies the day Media works. Zoom/Teams bots remain until those have a sanctioned listen API we are enrolled in.

## Alternatives rejected

- Wait for Media only — no Zoom desktop, no mixed-room Meet this quarter.
- Bot as default — spends the trust the manifest bought.
- Own headless joiner — 2026 detection arms race.
- Desktop “invisible” SDK — duplicates the extension.

## Revisit

First successful `connectTier2` in production → disable Meet bot the same day. Reopen “bot as default” only with measured evidence that tab capture is unused *and* lobby admit rate is high.
