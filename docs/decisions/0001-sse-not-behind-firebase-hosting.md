# The turn stream is not served through Firebase Hosting

**Status:** accepted · **Date:** 2026-08-24 · **Phase:** 2 (Streaming)

## Decision

`GET /api/sessions/:id/turn/stream` is served from the **gateway's own
hostname**, not through the `/api/**` Firebase Hosting rewrite that carries
every other API call. The web client points at it via `VITE_STREAM_ORIGIN`, and
the gateway allows that origin explicitly through `WEB_ORIGINS`.

Everything else stays exactly as it is: same-origin, behind Hosting.

## Why

The Phase 2 plan flagged this as a risk to verify *before* building on it. It
was verified first, and the answer was worse than expected.

**Firebase Hosting applies a 60-second request timeout to rewrites.** This is
documented on the Hosting pages for both Cloud Run and Cloud Functions, applies
even though Cloud Run's own timeout is far higher, and is **not configurable** —
there is a long-standing open feature request to make it so. A stream held open
past 60 seconds through a rewrite is severed with a `504`.

That alone settles it. A turn that waits on a slow model is exactly the case
streaming exists for, and it is exactly the case that would break.

Separately, a Firebase engineer stated in 2022 that Hosting "does not currently
support streaming responses (e.g. server-sent events, websockets) in rewrites to
Cloud Functions / Cloud Run — the entire response is buffered and cached in the
CDN layer." That evidence is thinner: one forum post, never refreshed, and not
reflected in any documentation page. We are not relying on it. It is recorded
because it points the same way, and because no confirmed-working setup was found
anywhere in 2024–2026.

## What was rejected

**Trying to defeat the buffering with headers.** `X-Accel-Buffering: no`,
`Cache-Control: no-transform` and friends are genuinely effective on nginx and
similar proxies, and we set them — but no report anywhere shows them working
against Hosting, and none of them touch the 60-second timeout.

**A global external ALB with a serverless NEG.** This would keep one hostname.
But a dated practitioner report shows SSE through a serverless NEG throttling at
roughly 5 concurrent connections where the direct Cloud Run URL sustained 100.
Unresolved, no Google response. Not something to build the streaming path on
without testing it under concurrency ourselves — which we can revisit if the
two-hostname split becomes a real problem.

**WebSockets.** Ruled out by the same statement, so this is not a way to stay
behind Hosting.

## Consequences

- The stream is **cross-origin in production**, which is why `sse.ts` does CORS
  and why the gateway answers preflight before authentication. In development
  Vite proxies it and it is same-origin, so this path is not exercised locally —
  worth remembering when it first ships.
- The Firebase ID token travels in an `Authorization` header rather than a
  cookie, so the cross-origin move costs nothing in credential handling. This is
  also why the client uses `fetch` + `ReadableStream` instead of `EventSource`,
  which cannot set headers.
- Cloud Run's request timeout must be raised for the gateway to cover the
  longest turn we intend to allow. Default is 300s, max 3600s.
- Nothing in `firebase.json` changes. The `/api/**` rewrite still serves every
  non-streaming call.

## Sources

- [Serve dynamic content with Cloud Run | Firebase Hosting](https://firebase.google.com/docs/hosting/cloud-run) — the 60s rewrite timeout
- [Serve dynamic content and host microservices](https://firebase.google.com/docs/hosting/serverless-overview) — same
- [Server Sent Events from functions? — Firebase Google Group, 2022-08-01](https://groups.google.com/g/firebase-talk/c/OaLXVN50hfM) — the buffering statement
- [Cloud Run serverless NEG behind global HTTPS LB — SSE throttled, 2026-05-11](https://discuss.google.dev/t/cloud-run-serverless-neg-behind-global-https-lb-sse-streaming-connections-throttled-vs-direct-cloud-run-url/361659)
- [Configure request timeout | Cloud Run](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
