# Voice audio travels through the gateway, not LiveKit

**Status:** accepted · **Date:** 2026-08-26 · **Phase:** 5 (Voice transport)

## Decision

The browser opens a WebSocket to **our gateway**. The gateway holds the Vertex
Gemini Live API session under its own ADC identity and relays PCM. The browser
holds **no model credential at all**.

There is no language picker. Native audio models auto-detect and switch
languages mid-conversation; `language_code` cannot be set. Language is steered
with system instructions. Igbo is not on Gemini's list (Yoruba and Hausa are).

LiveKit is not in this product. Revisit only if PSTN dial-in or a genuine
multi-party room arrives.

## Why this, now

Phase 5 tried to mint an ephemeral Live API token and let the browser talk to
Google. Tested against `alltheway-rinegan` on 2026-08-25:

```
client.auth_tokens.create()
  -> "This method is only supported in the Gemini Developer client."
```

Vertex does not issue those tokens. They exist for the Gemini Developer API,
which authenticates with an AI Studio key — ruled out. So the plan's
browser-to-Google shape has no implementation on this stack.

Architecture §3.8 already prescribed a mediator. The relay *is* that mediator,
and it is strictly stronger than the token plan: nothing in the browser can
reach the model except through us.

The language question and the transport question are independent. LiveKit adds
zero languages. The ceiling is Gemini's either way — currently 97 languages on
native audio, not the older "24 languages, 30 HD voices" line.

AllTheWay is 1:1 user↔agent. LiveKit's core value is an SFU for multi-party
rooms. There is no second participant to mix.

## Dominant trade-off

We take on reconnection, jitter, and PCM plumbing ourselves — including an
AudioWorklet (16 kHz in, 24 kHz out) rather than MediaRecorder — in exchange
for one trust boundary and no new vendor in the path of the most sensitive
data this product touches.

A WebSocket pins a Cloud Run instance for its duration. That changes
concurrency math: each live call is one occupied request slot until hang-up
or timeout. The gateway's request timeout is therefore 3600s (Cloud Run's
maximum), not the 300s default that was sized for a turn.

Audio-only Live sessions cap at **15 minutes** without context-window
compression; the WebSocket itself is ~10 minutes. Session resumption is
required regardless of transport. The gateway reconnects to Vertex on
`goAway`, using the last resumable handle, without dropping the browser
socket. The browser reconnects to *us* if *our* socket drops, sending the
handle so a new Vertex session can resume.

## What was rejected

**Ephemeral tokens, browser-to-Google.** Unavailable on Vertex. Even if they
existed, the browser would hold a model credential. Dead.

**LiveKit (or any WebRTC SFU partner).** Adds a vendor and a trust boundary
for a 1:1 call. Adds no languages. Reopens the credential question (their
token, our token, or both). Convenience is not a reason to put voice audio
through a third party.

**Firebase Hosting rewrite for the socket.** Same disqualification as the
turn stream ([0001](0001-sse-not-behind-firebase-hosting.md)): Hosting's
unconfigurable 60-second rewrite timeout, plus no WebSocket support on
rewrites. The voice socket uses the gateway hostname, same as SSE, via
`VITE_STREAM_ORIGIN`.

**Putting the Firebase ID token in the WebSocket URL.** Browsers cannot set
`Authorization` on `new WebSocket()`. A query-string token would land in
history, proxy logs, and `Referer`. The first message on the socket carries
the token instead; the upgrade itself is unauthenticated and is closed if
auth does not arrive within a few seconds.

## Consequences

- The gateway gains `roles/aiplatform.user`. Until now only the orchestrator
  and research-cell called Vertex. A gateway without that role would accept
  the browser socket and then 401 against Live — which looks like a voice bug.
- `POST /api/voice/token` is gone. It minted something Vertex cannot issue.
- Client protocol is ours (`auth`, `pcm`, `transcript`, `turn`, `interrupted`),
  not Vertex's. The browser never speaks `BidiGenerateContent`.
- Native audio: `gemini-live-2.5-flash-native-audio`. Input 16-bit PCM 16 kHz
  LE; output 16-bit PCM 24 kHz LE. Server-side VAD (barge-in). Echo
  cancellation from `getUserMedia`.
- Function calls from the Live session are executed by the gateway against
  the orchestrator over A2A (`plan_turn`). The confirm gate still runs. The
  model is not a path around it.
- Locally, `NODE_ENV !== production` uses a fake Live backend so the
  AudioWorklet path is testable with no GCP project. Production refuses to
  pretend: no Vertex identity means the socket closes with `voice_unavailable`.

## Revisit trigger

Reopen this if any of: PSTN / telephony is a product requirement; a session
has more than one human participant; Vertex starts issuing ephemeral Live
tokens *and* we have a reason to put a model credential in the browser
anyway (we do not today); or Gemini adds Igbo and we want to confirm native
audio still auto-switches rather than needing a picker.

## Sources

- [Start and manage a session | Gemini Live API](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/start-manage-session) — WebSocket URL, OAuth bearer, session resumption, `goAway`, 15-minute audio-only cap, ~10-minute connection lifetime
- [Gemini Live API overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api) — PCM rates, native audio model, VAD
- [Multimodal Live reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/multimodal-live) — setup / realtimeInput / toolCall; "Client authentication: server to server, not recommended for direct client use"
- Phase 5 measurement: `auth_tokens.create()` refused on Vertex, 2026-08-25
