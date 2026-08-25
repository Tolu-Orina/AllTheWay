# gateway

The API the web client talks to. Express + firebase-admin, deployed to Cloud Run
in `europe-west1` (which is what `web/firebase.json`'s `/api/**` rewrite matches).

## Running locally

Needs a JDK — the Firestore emulator is a Java process.

```bash
# terminal 1
npm run dev:emulators

# terminal 2
export $(grep -v '^#' .env.example | xargs)   # or set them in your shell
npm run seed          # once, populates the emulator
npm run dev:gateway
```

`GET http://localhost:8080/healthz` should return `{"ok":true}`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | Public. Cloud Run health check. |
| WS | `/api/voice/live` | Voice relay. Auth is the first JSON message, not a header. Not behind Hosting — same origin split as the turn stream. |
| GET | `/api/sessions` | |
| GET | `/api/sessions/:id` | 404 when absent |
| GET | `/api/watchers` | |
| GET | `/api/watcher-runs` | |
| POST | `/api/watchers/:id/running` | `{ running: boolean }` |
| GET | `/api/preferences` | Reverted entries are hidden, not deleted |
| POST | `/api/preferences/revert` | `{ id: string }` → 204 |

Everything under `/api` requires a verified Firebase ID token — except the
voice **upgrade**, which cannot carry headers from a browser. Auth is the
first JSON message on that socket; no token within a few seconds and it
closes.

## Things that are deliberate

**Auth is the real boundary.** The client route guard is UX — anyone can edit
their own JavaScript. `requireUser` verifies the ID token on every request, and
401s are vague on purpose: distinguishing "expired" from "malformed" tells an
attacker which half of their guess was right.

**`ALLOW_ANONYMOUS`** serves a fixed dev identity while the web client is still
on the local auth adapter. It refuses to engage when `NODE_ENV=production`, so
a stray env var cannot open a deployed service.

**Contracts are parsed, not trusted.** Every response goes through the zod
schemas in `@alltheway/contracts` on the way out, so a malformed document fails
in one place instead of surfacing as an undefined in the UI. The web client
imports the same schemas, so a field cannot be renamed on one side only.

**The Feedback Ledger is append-only.** Reverting a preference sets
`revertedAt`; it never deletes the row. The correction is part of the record.

**No Genkit yet.** Genkit is an AI-flow framework and these endpoints are
Firestore reads — wrapping them in it would be decoration. It arrives with the
orchestrator, where model calls actually happen.

**No key files.** Emulator: no credential at all (handing firebase-admin a fake
one makes it try to parse a private key and fail). Real project: Application
Default Credentials locally, the service account on Cloud Run.

## Vertex

Model calls use the **`global`** endpoint, pinned to `gemini-3.7-flash`. That is
independent of where the service runs. `global` carries no EU data residency —
if that becomes a requirement, the endpoint moves and the model pins back to a
DRZ-supported one.

Never `latest`: a silent model swap changes agent behaviour under you.
