# Time zone is IANA; look-up is grounded search

**Status:** accepted · **Date:** 2026-08-31 · **Phase:** Clock and look-up

## Decision

The product answers “what time is it” and “where am I” from an **IANA time
zone** and how we know it (this device, the connected calendar, or an override
they set). It looks up a public fact with **Vertex `googleSearch` grounding**.
A URL that did not come back in grounding metadata is not a citation.

GPS, IP geolocation, Custom Search, scraping, and browse-any-URL are not in
this product.

## Why this, now

A companion that cannot tell local midnight from UTC midnight answers “did I
have a meeting today” wrongly. A companion that invents a city from an accent
or an IP is a map pin they never consented to. Those are different failures,
and they are both worse than being slightly less convenient.

Look-up is a **read**. Writes still stop at confirm-before-act. Voice cannot
wait on the research swarm (~30s); it uses a thin `look_this_up` (~8s) that
obeys the same cited-or-silent rule (FR-D2). Companion and work go through the
research cell: one grounded fetch, then the existing two-angle synthesis.
Workers never reach the user (FR-10). Web chips open only URLs the grounding
metadata actually returned.

## Dominant trade-off

We know the zone, not the street. “Where am I” is “Europe/London, from this
device”, never a pin. Travellers who keep a home calendar see both zones named
in CLOCK rather than a silent pick. Search cannot open an arbitrary page; it
can only cite what Google Search grounding handed back.

## What was rejected

**GPS / `navigator.geolocation`.** A permission prompt for a capability we do
not need, and a pin we would then have to pretend not to store.

**IP geolocation.** Quiet, inaccurate, and a city guess from a network
address. Language is not location either: a Yorùbá speaker in London is still
in `Europe/London`.

**Custom Search, scrape, or browse-any-URL.** A second search stack, or a
fetch the model asked for, would let a URL the model invented become a
citation. Grounding metadata is the only web URL path.

**A second research-cell A2A skill for voice.** The card stays one skill.
Voice’s thin look-up lives on the gateway so a spoken question is not a 30s
silence.

## Consequences

- Firestore `users/{uid}/settings/clock` holds `deviceTimeZone`,
  `calendarTimeZone`, and optional `overrideTimeZone`. A device ping updates
  the device zone only; it does not clear an override.
- CLOCK is injected into typed turns and the live system instruction. It
  starts with `CLOCK:` so a legacy ISO instant is not wrapped twice.
- ConfirmGate defaults a new event to the calendar zone, then the device
  zone, then UTC — never a hard-coded London fallback.
- Voice `look_this_up` and the research cell share the cited-or-silent rule.
  The model cannot invent a web URL.
