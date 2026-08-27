# AllTheWay — Devpost submission draft

> Draft. Four fields need your input before submitting — marked **[NEEDS YOU]**. Everything else is drawn from the repo.

---

## Inspiration

I kept noticing the same gap in every AI assistant I used. They were good at answering and useless at *following through*. You'd have a long, useful conversation, close the tab, and none of it had any consequence. Nothing was watching. Nothing remembered that you'd corrected it about the same thing three times. The next session started from zero, and you started over with it.

The other thing that bothered me was how little you could see. You'd ask for something, a paragraph would appear, and you had no idea what it read, which tool it called, or whether it had quietly done something on your behalf. When people say they don't trust these systems, I don't think they mean the model is wrong too often. I think they mean they can't check.

So AllTheWay started from two commitments. It should keep working when you're not looking at it. And everything it does should be visible enough to audit — not a summary of what it did, but the actual trace.

## What it does

AllTheWay is a companion you talk to, that watches and acts for you, and that learns how you think from your corrections.

**Voice, properly.** Real-time speech in and out over a WebSocket, with the audio relayed through our own gateway so we can meter it, screen it, and keep the transcript. It handles 85+ languages and code-mixing mid-sentence — which matters more than it sounds, because plenty of people don't speak one language at a time.

**Watchers.** Standing instructions that run without you. "Watch this inbox and draft a reply when a contract arrives." Each watcher has an autonomy ceiling you set — draft only, send after review, or send automatically — and there's a floor enforced server-side that no setting can raise. Anything irreversible stops and asks.

**Meetings.** It joins, listens, and takes notes, and it cannot speak — that's a hard property, not a setting. Everyone is asked before it connects. It ladders down gracefully: live transcription when available, reading the transcript afterwards when not, and a browser extension that captures locally when neither is possible. Live insights arrive on a backing-off schedule — one minute, three, five, ten, fifteen, then every fifteen — so a ninety-minute meeting costs ten reasoning passes instead of ninety.

**Documents.** Add a contract or a spec and it answers from it with citations you can click. Deleting the document removes what it learned from it.

**Artifacts you can correct.** Every document, image or video it produces is versioned. When you say "no, shorter, and drop the second paragraph", that correction is stored as the reason for the next version. The Feedback Ledger is append-only — reverting a learned preference stamps it rather than deleting it, so the history of what it believed about you stays intact.

**Everything is inspectable.** Every specialist agent publishes a signed AgentCard, and the Agents page verifies each signature *at the moment you ask*, not at deploy time. If a capability stops verifying, the page says so.

## How we built it

Nine services on Cloud Run, one GCP project, everything in Terraform with dev and prod as workspaces.

The gateway is the only service reachable from the internet. It's Express with `firebase-admin`, and it holds the voice WebSocket, which is deliberate: it's the only process that can observe how long a session actually lasted, so it's the only place usage can be metered without trusting the client to report its own consumption.

Behind it, the orchestrator runs the planning graph — the Clarify Gate that stops a turn when the request is ambiguous instead of guessing, and the confirm gate that refuses to run a plan with an irreversible step until you say yes. Around it sit the librarian (documents and retrieval), the scribe (meetings), the research cell, the connector gateway, the registry, the watcher runtime, and the profile synthesiser that turns corrections into learned preferences.

Services talk to each other over A2A with signed AgentCards — ES256 detached JWS over canonically-serialised JSON, with the `signatures` field excluded from what's signed. The Python side publishes and the TypeScript side signs, and we proved the interop by having the Python library verify a card the TypeScript signer produced.

Firestore holds everything, path-scoped per user. There are no collection-group queries anywhere, and a guard in CI fails the build if one appears — cross-tenant retrieval is the one failure this product cannot have.

Untrusted content is screened before any model reads it, and the screener fails closed. We tested it the only way that means anything: we fed it a prompt injection, confirmed it was transcribed rather than obeyed, then confirmed the screener blocked it.

The whole thing is guarded by five checks that run before anything ships — tenant isolation, image dependencies, the plan table matching what's actually enforced, locale completeness, and whether every test file is genuinely being executed.

## Challenges we ran into

**The bugs that passed every check.** This is the theme of the project. Nearly every serious failure compiled cleanly and had green tests.

The worst was an ingress misconfiguration. Every backend service was set to internal-only, which reads as the strict, correct choice — but there was no VPC anywhere in the Terraform, and a Cloud Run service calling another one leaves over the public internet unless its egress is routed through a VPC. Cloud Run rejects those with a **404, not a 403**, so the gateway dutifully turned it into a 502. The agents page had returned 502 for thirty days and had *never once succeeded*. We only found it by reading production request logs and noticing that every endpoint the gateway served itself returned 200, while every endpoint it proxied failed.

Fixing that revealed a second fault hiding underneath. `google-auth` doesn't install `requests`, and `google.auth.transport.requests` raises `ImportError` without it. That import sat inside a broad `except`, logged at `debug` — which is also exactly what a developer laptop with no metadata server looks like. So every internal call had been going out with no `Authorization` header at all, invisibly, for weeks. Two stacked faults, and the first was masking the second.

Then there was the typechecking that wasn't. `web`'s tsconfig is solution-style with `"files": []`, which means `tsc -p` checks nothing and exits 0. There was no `typecheck` script at all, and CI ran lint and build — but Vite builds with esbuild, which strips types without reading them. Type errors had been reaching production as runtime failures the entire time.

**Guards that couldn't fail.** We wrote a dependency check that could never trip, because the pattern it looked for was matched by an unrelated `COPY` line. And a `terraform validate` that passed vacuously because it ran in a directory holding only tfvars. Both looked green for weeks. The rule that came out of it: after writing a guard, break the thing on purpose and watch it fail, or you haven't written a guard.

**Terraform's `merge()` is shallow.** A service listed in two maps lost the keys from the first, which took secret-access IAM down to three of five services and caused a short production incident.

**Costs that bite once.** An early test wasn't stubbed properly and would have started a real video generation. It only cost nothing because a credential allow-list happened to block it. We rewrote it to stub the connector and assert the real path is never reached.

## Accomplishments that we're proud of

**Tenant isolation that's structurally enforced, not just intended.** No collection-group queries, no user-owned root collections, and a guard that fails the build if either appears. "Cross-user retrieval is unacceptable" is a sentence a lot of projects would put in a README. Here it's a check that runs before every deploy.

**The autonomy floor.** Tests were written before the mechanism, and it's still the strongest code in the repo. A watcher cannot take an irreversible action regardless of how its ceiling is configured — the floor is server-side and no client setting can raise it.

**Meeting insights that cost what they should.** The backing-off schedule holds a ninety-minute meeting to ten reasoning passes instead of ninety, without the user having to think about it.

**Signed capability contracts, verified live.** The Agents page checks each signature when you open it. A capability that silently stops verifying is visible immediately, rather than at the next deploy.

**Seven languages, wired end to end.** 120 keys, each locale shipped as its own ~8KB chunk so a French user never downloads Yoruba and an English user downloads neither. **Internationalisation that respects grammar.** Plural categories come from `Intl.PluralRules`, never a hand-written table. Welsh has six categories and drives consonant mutation — *peth* becomes *beth* becomes *pheth* — and it's driven correctly by the plural category. A `count === 1` check would read as illiteracy to a native speaker.

**Honest failure states.** Errors say what happened and what's safe. "Your work is safe — nothing was lost" is a real guarantee here, not reassurance.

## What we learned

**A green build is evidence of very little.** The single most valuable habit we developed was reproducing the failure, fixing it, then reproducing the fix. Every significant bug in this codebase typechecked.

**Silent failure paths are worse than loud broken ones.** The missing `requests` package cost weeks precisely because it was handled gracefully. A broad `except` that logs at `debug` turns a packaging bug into an invisible one. We now distinguish the two cases explicitly: a metadata server that won't answer is normal on a laptop and stays at debug; a build that *cannot* mint tokens at all is an error that names the fix.

**404 doesn't always mean "not found".** Cloud Run uses it for ingress rejection, which sends you looking for a routing bug when the problem is network policy.

**Read the logs before forming a theory.** The breakdown of which paths returned 200 and which returned 502 identified the root cause in about a minute, after a good deal of speculation had gotten nowhere.

**Write the interface for the person who has to trust it.** The most valuable design decisions weren't technical — the confirm gate, the append-only ledger, the live signature check. Those are what make the thing checkable, and checkable is what trust actually rests on.

## What's next for AllTheWay

- **Native review of the six machine-drafted catalogues.** The interface is wired and switching language works, but only English has been read by someone who speaks it. Machine translation is a first pass, not a release.
- **Session creation.** Sessions can be read but not created; the flow needs building end to end.
- **Real observability on the turn path.** The orchestrator currently logs only startup and shutdown, so a failed turn leaves no trace. That's the next thing to fix, and it should have been first.
- **Publish the browser extension** once the privacy policy and store listing are done.
- **Payments**, deferred deliberately until the product questions behind them are settled.
- **Google Meet Developer Preview** integration, deferred to v4.

---

## Built with

`google-cloud` · `cloud-run` · `firestore` · `firebase` · `firebase-auth` · `firebase-hosting` · `vertex-ai` · `gemini` · `veo` · `gemma` · `terraform` · `typescript` · `python` · `react` · `vite` · `tailwindcss` · `fastapi` · `express` · `zod` · `a2a-protocol` · `mcp` · `websockets` · `pub-sub` · `cloud-build` · `chrome-extension`

*(25 tags — the maximum)*

## URL to code repo

`https://github.com/Tolu-Orina/AllTheWay`

**[NEEDS YOU]** If it's private, share it with `testing@devpost.com` and `cloudhackathons@google.com` before you submit.

## What date did you start this project?

**[NEEDS YOU]** Git history begins **08-25-26**, but that is when the project was added to source control — not when you started building. Entries must be newly created during the submission period, so put the real start date and check it falls inside the window.

## Did you add Reproducible Testing instructions to your README?

**[NEEDS YOU] — currently no.** The README has a "Running locally" section but nothing labelled reproducible testing. I can write one covering emulator setup, the guard commands and how to run every suite. Test account: `alltheway@rinegansolutions.com` — put the password in the Devpost field, which only Devpost managers and judges see.

## Which Google SDK did you use?

- **Google Gen AI SDK** (`google-genai`) — all Gemini and Veo calls
- **A2A SDK** (`a2a-sdk`, with the `fastapi` extra) — agent-to-agent protocol
- **Firebase Admin SDK** (`firebase-admin`) — auth and Firestore server-side
- **Google Cloud client libraries** — `google-cloud-firestore`, `@google-cloud/pubsub`, `@google-cloud/storage`
- **google-auth** — service-to-service identity tokens
- **MCP SDK** (`mcp`) — agent-to-tool, kept deliberately separate from A2A

## Which Google Cloud Service(s) did you use?

Cloud Run · Firestore · Firebase Authentication · Firebase Hosting · Vertex AI · Cloud Build · Artifact Registry · Secret Manager · Pub/Sub · Cloud Scheduler · Eventarc · Cloud Trace · Cloud Storage · Model Armor · IAM and IAM Credentials · Cloud Resource Manager · Org Policy · Google Meet API · Workspace Events API

## Which Google AI Models did you use?

**Gemini (3.5+ requirement met):**

- `gemini-3.7-flash` — planning and reasoning, with `googleSearch` grounding
- `gemini-3.5-transcribe-live-preview` — live meeting transcription (85+ languages, mid-session code-mixing)
- `gemini-live-2.5-flash-native-audio` — real-time voice conversation
- `gemini-3.1-flash-lite-image` — image generation
- `gemini-embedding-001` — document retrieval embeddings

**Additional models (bonus points):**

- **Veo** — `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, `veo-3.1-lite-generate-001`. Split into draft and final meters because the two ends of the ladder differ roughly fifteen-fold in cost.
- **Gemma** — `gemma-3-4b-it`

## Architecture diagram

**[NEEDS YOU]** Not yet produced. I can generate one from the Terraform and the service graph on request.

## Optional bonus items

- **Content piece (blog, podcast, video)** — not created. Must be public, not unlisted, and must state explicitly that it was created for this hackathon.
- **Social media post** — not created. Must include **#AllThingsAgentic Hackathon**.
