# AllTheWay v3 — Implementation Plan

*Companion to [Product Manifest v3](AllTheWay-Product-Manifest-v3.md). The manifest says what to build and why. This says how, in what order, to what standard, and how each piece is proven to work.*

**Date:** 2026-08-26 · **Prerequisite:** Phases 0–8 delivered and deployed · **Status:** proposed

---

## 0. How to read this

Seven phases, A–G. Each carries the same seven sections, in the same order, because a phase that skips one is a phase that will be found to have skipped it later:

**Goal · Data model · Services & infrastructure · Interface · Requirements met · How it is proven · What could go wrong**

Two conventions inherited from Phases 0–8 and non-negotiable here:

- **Tests before the mechanism** for anything safety-bearing. The autonomy floor was written that way and is the strongest code in the repo.
- **Verify by running.** Every significant bug in this codebase passed typecheck: the swallowed `/healthz`, the nested `ws@7`, the Live model absent from `global`, the trigger that never watched `libs/`. A phase is not done because it compiles.

---

## 1. The production bar

Every phase inherits this. It is not aspiration — each line is a rule the existing codebase already enforces, and new code that breaks one is a regression.

### 1.1 Safety and failure direction

| Rule | Why | Enforced today by |
|---|---|---|
| Untrusted content is screened before a model reads it, fail-closed | An attacker's first move is to break screening | `libs/screening`, `screen()` returns blocked on any screener failure |
| A screening layer may only ever add a block | Adding a layer must never make the system less cautious | FR-S2, `alltheway_screening` composition |
| Irreversible actions need confirmation, and the label is not trusted | The model omitted it in 4 of 12 measured runs | `plan_validation.validate()`, escalate-only |
| Absent configuration is the strict case | A missing row is the most likely state during an outage | `org_policy.DEFAULT`, `plan_for()` → Free |
| Usage is counted after success | Charging for refusals lets a caller exhaust its own allowance | `a2a_executor`, `usage.record` |
| Secrets are mounted, never passed | Keeps values out of Terraform state and revision specs | `secret_env_vars` |
| Per-secret, per-service IAM | The registry gets the public key and never the private one | `secrets.tf` |

**New in v3, and load-bearing:**

- **A document is untrusted content.** A PDF a user chose to upload is still a PDF a stranger wrote. It goes through the same fail-closed path as watcher email. (FR-D1)
- **Grounded or silent.** A document-derived claim carries a citation or states it could not ground the answer. A confident wrong summary of an indemnity clause is the worst failure this product can have. (FR-D2)
- **Video is confirmed at every ceiling and never available to a watcher.** A watcher able to spend £5 unattended is an unbounded liability with a nice name. (FR-M2)
- **Retrieval is scoped by the storage path, not by a filter.** Cross-user retrieval is a breach, not a defect, and it is defended seven times over — see §1.4, which exists because one filter is not a control. (FR-D4a–e)

### 1.4 Tenant isolation — the one property with no acceptable failure rate

Every other rule in §1.1 has a tolerable failure mode. A missed screening degrades to a blocked run. A wrong plan label degrades to an unnecessary confirmation. **One user retrieving another user's document has no degraded state** — it is a data breach involving contracts, meeting transcripts and photographs, which is the most sensitive material this product has ever held.

So it is not defended by a filter. It is defended seven times, and each layer assumes the one above it has already failed.

| # | Layer | Fails how |
|---|---|---|
| 1 | **Path scoping** — chunks live at `users/{uid}/documentChunks/{id}` | A query rooted at the wrong path cannot see another user's data even with no filter at all |
| 2 | **No collection-group queries, ever** | `collectionGroup` is the only construct that spans users. Absent from the codebase today; CI keeps it that way |
| 3 | **Redundant field filter** — `ownerUid == uid` inside the scoped path | Catches a hand-built path |
| 4 | **Identity is derived, never passed** | The librarian will not accept a `uid` argument from a caller; it verifies a scope token minted by the gateway |
| 5 | **Post-retrieval assertion** | Every chunk's owner is checked against the requester before it enters a prompt; a mismatch raises and kills the turn |
| 6 | **Adversarial test as a release gate** | Two seeded users; querying as B returns zero of A's chunks, asserted at each layer |
| 7 | **Traces never carry passage text** | Even a leak of *metadata* must not leak *content*, the same rule screening already follows |

**Layer 1 is the one that matters most, and it is not new.** `preferences(uid)`, `sessions(uid)` and `watchers(uid)` already work this way — the owner is in the *path*, not in a field someone has to remember to filter on. Documents follow the established pattern rather than inventing a weaker one.

**Layer 4 deserves its own sentence.** If the librarian accepted a `uid` parameter, then every caller becomes part of the isolation boundary, and a bug anywhere in the orchestrator becomes a cross-tenant read. It accepts a signed, short-lived scope token instead, so the set of code that can cause a breach is one service rather than four.

**Sharing (Phase E) never widens retrieval.** A shared artifact grants access to *that artifact*, never to the chunks behind it. Retrieval scope stays exactly one user, permanently. Any future "team corpus" is a different feature with its own isolation design, not a relaxation of this one.

### 1.2 Delivery

- **Terraform gates:** `fmt` → `validate` → `tflint` → `plan` reviewed → `apply`. No exceptions, and `plan` must be clean afterwards.
- **`scripts/check-image-deps.py` passes.** Three separate outages came from a service importing a library its image did not carry.
- **Every new shared library is added to the importing service's Dockerfile *and* its wheel build**, in the same commit as the import.
- **Path filters include shared code.** `included_files` already covers `libs/**` and `services/contracts/**`; a new shared directory must be added there or its changes will deploy nothing.
- **The test stage is a build stage.** `docker build --target test` fails the build. This is what caught the registry's missing protobuf before it shipped.
- **Probing a generative endpoint is not a read.** Use a deliberately invalid payload: `400` means it exists and refused; `200` means it exists and is now billing you. Two Veo generations ran at ~$6 each before this was a rule.

### 1.3 Observability

Every phase adds: a boot log line stating its configuration, structured errors, and its own line in the Transparent Trace. A capability that cannot be seen working cannot be trusted to be working.

---

## 2. Design principles

The interface bar, stated before any phase so that "UI/UX" is a specification rather than a taste argument.

### 2.1 The five patterns, and where we stand

The agent-interface patterns that have converged as table stakes:

| Pattern | Today | v3 |
|---|---|---|
| Planning visibility | Plan Panel ✔ | extends to artifact and document work |
| Tool-use disclosure | Transparent Trace ✔ | adds retrieval, screening layers, model used |
| Memory surfacing | Cognitive Profile ✔ (partial) | adds visual preferences, struggle model, documents |
| Multi-step workflow tracking | ✗ | Artifact version history (Phase A) |
| **Recovery routing** | ✗ | every failure gets a route forward (Phase F) |

Recovery routing is the one most often missing in the category, and we are missing it. A failed turn currently shows a message and stops.

### 2.2 The rules

**R1 — Conversation and artifact sit side by side.** Chat does not scale past a few steps; the scroll-to-find-context pattern breaks. The third column stops being a transcript and becomes the thing being worked on.

**R2 — Capture and approve on mobile; compose and correct on desktop.** Every capability must have a defined mobile behaviour. A feature with no mobile answer is not finished.

**R3 — Provenance is pixels, not prose.** A grounded claim shows its source inline and opens the passage. A generated image is visibly labelled. The trust story is only real if it is on screen.

**R4 — Lead with what remains.** "12 runs left" can be planned against; "38 used" is trivia until it is too late. Already true of Usage; extends to every meter.

**R5 — A stopped turn must never look like a finished one.** Applied in the companion panel; applies to every new surface.

**R6 — Cost is disclosed before it is spent**, in the units the user's plan is denominated in, not in dollars.

**R7 — Reduced motion, contrast, and keyboard reach are inherited, not re-earned.** New surfaces run the existing browser checks.

### 2.3 The design thinking behind the Canvas

The question is not "where do we put artifacts" but **what is the user's attention doing**.

In conversation, attention is on the *exchange* — the last thing said. In creative work, attention is on the *object* — the thing being made. These want opposite layouts: a transcript scrolls away from you; an object stays still.

Today's third column is a transcript. Making it an object, with the conversation acting on it, resolves the conflict rather than compromising between them — and it is what Claude's artifacts, ChatGPT's canvas, Figma and Miro all independently arrived at.

**The move: the panel keeps its position and changes its noun.** No new navigation, no new mental model, no relearning. On desktop it is the third column; on mobile it is the sheet built in the companion work — promoted from chat to artifact.

---

## 3. Cross-cutting decisions

Each records what was chosen, what was rejected, and why — so a future reader can tell a decision from an accident.

### 3.1 Retrieval: Firestore vector search

**Chosen:** Firestore vector search, embeddings stored beside chunk metadata in the database we already run.

**Rejected: Vertex AI Vector Search.** It is the stronger engine at scale and the wrong shape here. It is a separate index endpoint with its own lifecycle, and per-user isolation becomes a namespace-and-filter concern *outside* the datastore that already enforces user scoping. FR-D4 says cross-user retrieval is a defect; the design that makes that hardest to get wrong is one where the user scope is part of the query.

Firestore supports **pre-filtering via composite indexes** — `where("userId","==",uid)` combined with a nearest-neighbour query. That is the whole argument: **scoping is in the query, not applied to its results.**

**Rejected: Vertex AI Search / RAG Engine.** Turnkey, and they own chunking, citation and retrieval policy. We need citation to be ours (FR-D2) and screening to sit *before* ingestion (FR-D1). Handing that to a managed pipeline means handing over the controls the product's trust story rests on.

**Constraints accepted:** 2048 dimensions max. Revisit if a single user exceeds ~10k chunks.

### The embedding model, verified

**Chosen: `gemini-embedding-001`, truncated to 1536 dimensions, in `europe-west1`.**

The default configuration of the obvious choice would have failed, which is the whole reason this was measured rather than assumed:

```
gemini-embedding-001   requested=default   actual=3072   <- EXCEEDS Firestore's 2048 cap
gemini-embedding-001   requested=1536      actual=1536
gemini-embedding-001   requested=768       actual=768
text-embedding-005     requested=default   actual=768
text-multilingual-...  requested=default   actual=768
```

`gemini-embedding-001` emits **3072 dimensions by default — 50% over the cap.** Writing it into a Firestore vector index without setting `outputDimensionality` fails, and it fails at write time on real user documents rather than in development. This is the same class as the Live model absent from `global`: the sensible-looking default is the broken one.

**Truncation was tested, not trusted.** Matryoshka representation learning claims a truncated vector stays useful; that claim was checked by embedding a target clause, a paraphrase of it, an unrelated sentence, and a Yoruba translation, then comparing cosine similarity at each dimension:

```
dim=3072   related=0.706   yoruba=0.579   unrelated=0.531   ordering holds
dim=1536   related=0.681   yoruba=0.541   unrelated=0.491   ordering holds
dim=768    related=0.698   yoruba=0.556   unrelated=0.504   ordering holds
```

1536 is chosen over 768 for headroom, and over 3072 because 3072 is not an option.

**All four embedding models are available in `europe-west1`** — unlike Nano Banana 2 Lite and Veo, which are `global`-only. This matters more than it first appears: **a user's documents, the most sensitive data v3 introduces, can be embedded in-region.** It partly answers §14.3 — the residency problem is confined to generated media, not to the corpus.

**A caveat that Phase B must carry:** cross-lingual retrieval works but the margin is thin. At 1536, a Yoruba query scores 0.541 against a matching English clause and 0.491 against an unrelated one — a separation of 0.05, against 0.19 for an English paraphrase. The product supports 97 languages in voice, so a user may reasonably ask about an English contract in Yoruba and get noisy results. Phase B's evaluation set must include cross-lingual pairs, and if the margin does not hold, the answer is to translate the query before embedding rather than to pretend it works.

### 3.2 Document parsing: Gemini native first

**Chosen:** Gemini's native PDF and image understanding for extraction, with **Document AI Layout Parser** as an explicit escalation for documents where structure carries meaning (tables, forms, multi-column contracts).

**Rationale:** fewer moving parts, one vendor surface we already hold IAM for, and no second parsing pipeline to keep correct. The escalation exists because a 40-page supplier agreement is exactly the case where naive text extraction destroys the structure that makes a clause findable.

**Trigger for escalation:** measured, not guessed — if grounded-answer accuracy on table-heavy documents falls below the bar in Phase B's evaluation set, Layout Parser goes in front.

### 3.3 Artifact storage: GCS, with Firestore as the index

Bytes in Cloud Storage (versioned bucket, CMEK-ready, lifecycle rules). Metadata, versions, provenance and ownership in Firestore. Same split as the manifest's own reasoning for subscriptions and usage: the durable blob and its index have different lifecycles and different access patterns.

### 3.4 Where the new code lives

| Capability | Where | Why |
|---|---|---|
| Artifacts | **gateway** | browser-facing CRUD, already owns Firestore and auth |
| Ingestion & embedding | **new service `librarian`** | CPU-heavy, bursty, long-running; must not share a pod with request latency |
| Retrieval at turn time | **orchestrator** → librarian over A2A | retrieval is part of planning, and the orchestrator is the planner |
| Image & video generation | **connector-gateway** | it is the policy enforcement point, and generation is a metered, confirmable effect |
| Meet media client | **new service `scribe`** | holds a long-lived WebRTC session; same shape as the voice relay |
| Meet transcripts (Tier 1) | **scribe** | one service owns meetings, whichever tier serves them |

**Two new services, not five.** Each exists because it has a genuinely different runtime profile — bursty CPU, or a pinned long-lived connection — not because it is a different noun.

### 3.5 Generation belongs behind the policy point

Image and video generation are **registered tools in the connector gateway's registry**, with severities:

```python
"media": {
    "generate_image":  Action.CREATE_TASK,   # cheap, conversational
    "draft_video":     Action.CREATE_TASK,   # ~$0.05/s, confirmed
    "render_video":    Action.MAKE_PAYMENT,  # ~$0.75/s — priced as what it is
}
```

`render_video` is classified `MAKE_PAYMENT` deliberately. It is the highest rung of the autonomy floor, so it can never be reached unattended at any ceiling, and it inherits the double-confirmation the floor already applies to payments. **The most expensive action in the product is governed by the machinery already built for the most dangerous one.**

---

## 4. Phase A — Artifacts & Canvas

**First, deliberately.** Documents without artifacts produce answers that vanish; images without artifacts produce pictures you cannot correct. The noun must exist before the things that produce it.

### Goal
A durable, versioned, correctable thing the agent produced, and a place to look at it.

### Data model

```
users/{uid}/artifacts/{artifactId}
  ownerUid            <- redundant on purpose (layer 3)
  sessionId, kind: doc|image|video|summary|checklist
  title, currentVersion, createdAt, updatedAt
  provenance: { agentId, cardVersion, model, sources[] }

users/{uid}/artifacts/{artifactId}/versions/{n}
  storagePath (gs://), mimeType, bytes, createdAt
  producedBy: user|agent, prompt, correction
  supersedes: n-1
```

**Under the user's path, not at the root.** An earlier draft of this section put artifacts in a flat collection with an `ownerUid` field — written before §1.4 existed, and exactly the shape it forbids. `scripts/check-tenant-isolation.py` would have failed the branch. Corrected here so the two sections agree.

Sharing (Phase E) still works across this path: a Firestore rule can grant a non-owner read on `users/{owner}/artifacts/{id}` without the reader's uid appearing in it. **A scoped path constrains queries, not rules.**

**Versions are append-only.** An artifact's history is evidence of how the work happened; a mutable current-state row loses exactly the thing that makes the Feedback Ledger valuable.

### Services & infrastructure
- Gateway routes: `GET/POST /api/artifacts`, `GET /api/artifacts/:id`, `POST /api/artifacts/:id/versions`, `GET /api/artifacts/:id/export`
- GCS bucket `alltheway-artifacts-{env}`, uniform access, versioning on, per-user prefix
- `roles/storage.objectAdmin` for the gateway on that bucket only
- Firestore composite index on `(ownerUid, updatedAt DESC)`
- Firestore rules: an artifact is readable only by `ownerUid` (until Phase E adds shares)

### Interface

**The third column becomes the Canvas.** Same position, new noun (§2.3).

- **Desktop:** conversation left, artifact right, version selector in the artifact header
- **Mobile:** the existing sheet, promoted — artifact full-bleed, conversation reachable by tab within the sheet
- **Version history** as a compact strip, not a modal. Seeing that v3 came from "make it simpler" is the product's own thesis made visible
- **Export** always present. Work you cannot take out is work you do not own
- **Empty state** names what the canvas is for, rather than apologising for being empty

### Requirements met
Manifest §7.3. Establishes the substrate for FR-D2 citations and FR-M4 visual preferences.

### How it is proven
- Unit: version chain is append-only; a superseded version is never mutated; export round-trips bytes
- Security: a second user cannot read another's artifact — asserted, not assumed
- **Browser:** create → correct → version appears → export downloads, at 390px and 1440px, no horizontal overflow, reduced motion respected
- The existing `test:companion` checks extend to the canvas

### What could go wrong
- **Version explosion** on rapid correction → coalesce versions inside a short window, and never coalesce across a user edit
- **Bytes without an index row** if a write half-fails → write GCS first, Firestore second; an orphaned blob is garbage, an index row pointing at nothing is a broken artifact

---

## 5. Phase B — Documents & Retrieval

### Goal
Bring in the thing you are actually working on, and answer from it with citations — or say you cannot.

### Data model

```
users/{uid}/documents/{documentId}
  title, mimeType, storagePath, pages
  status: screening|indexing|ready|blocked
  screening: { verdicts[], blockedReason }
  createdAt

users/{uid}/documentChunks/{chunkId}
  ownerUid            <- redundant on purpose (layer 3)
  documentId, page, ordinal, text
  embedding: Vector(1536)
```

**The owner is in the path, not only in a field.** This follows `preferences(uid)` / `sessions(uid)` / `watchers(uid)` rather than inventing a flatter, weaker scheme for the most sensitive data in the product. A vector query is rooted at `users/{uid}/documentChunks` and therefore *cannot* see another user's chunks — no filter required, and no filter possible to forget.

`ownerUid` is still written to every chunk, redundantly, as layer 3. Redundant controls are the point: the failure being defended against is a developer, in a hurry, eighteen months from now.

The vector index is per-collection, which this shape gives for free. **No `collectionGroup` query is permitted against these collections** — it is the only construct that would span users, and `scripts/check-tenant-isolation.py` fails the build if one appears.

### The two memories, kept apart

Manifest §3.1 separates **preference memory** (how you like things done) from **working memory** (what you are working on). The plan must not quietly merge them, because merging them is exactly why retrieval was missing in the first place.

| | Preference memory | Working memory |
|---|---|---|
| lives in | `users/{uid}/preferences` | `users/{uid}/documentChunks` |
| reaches the model by | injection into every prompt | retrieval, per turn, on relevance |
| size | tens of short strings | thousands of chunks |
| grows by | correction | use |
| user controls it by | revert | delete the document |

**Injection does not scale and retrieval does not personalise.** A preference is short, always relevant, and cheap to include every time. A document chunk is long, rarely relevant, and ruinous to include every time. They are different mechanisms because they answer different questions, and the existing `knownPreferences` path stays exactly as it is.

### The struggle model

Manifest §3.2 asks the agent to notice what a user finds hard. That is state, not a prompt instruction:

```
users/{uid}/concepts/{conceptId}
  label, documentId
  encountered, reasked, reexplained    <- counters
  confidence: 0..1, lastSeenAt
```

It sits beside preferences in the Cognitive Profile — **visible and revertible like everything else there**, because a model of your weaknesses that you cannot see or correct is the least acceptable kind of hidden state this product could hold.

It is the input that makes the third explanation different from the first, and it is what the guided-understanding loop (§4.3 of the manifest) reads.

### Services & infrastructure
- New service **`librarian`** (Cloud Run, internal-only, invoker: orchestrator + gateway)
- Pipeline: **upload → screen → parse → chunk → embed → index**, in that order, with screening first
- Firestore vector index on `documentChunks.embedding`, composite `(ownerUid, embedding)`
- Deletion removes chunks and the blob, and reports what was removed

### The screening order is the whole design — restated, because the first version was impossible

An earlier draft of this section said "parse after screening, never before". **That cannot be done.** A PDF's text does not exist until something extracts it, so there is nothing to screen until parsing has already happened. The instruction was unimplementable, and following it literally would have meant screening the raw bytes of a compressed container — which detects nothing.

The invariant that actually matters is narrower and achievable:

> **No model reads content that has not been screened.**

Which gives a real order, with the boundary in the right place:

```
1. extract      mechanical, no model      pypdf / image decode
2. screen       the extracted text        Model Armor + Gemma, fail-closed
3. chunk        only if screening passed
4. embed        only if screening passed  <- first contact with a model
5. index
```

Mechanical extraction is safe from prompt injection because no model is involved — an instruction inside a PDF is just text to `pypdf`. Step 4 is the first moment a model sees anything, and nothing reaches it that has not passed step 2.

**Extraction carries a different risk, and it is not screening's job.** A malicious PDF can attack the *parser* (a memory-safety bug in the extraction library), which no amount of content screening prevents. That is mitigated by keeping extraction in the librarian — a separate service with no credentials beyond its own, no connector access, and no ability to act — rather than by pretending screening covers it.

`librarian` gets `roles/modelarmor.user` and the Gemma layer from Phase C's §5A work; whichever lands first wires the other in.

### Retrieval at turn time

The orchestrator calls the librarian over A2A. Retrieved passages enter the prompt **labelled as retrieved, untrusted context**, and every claim built on them carries a citation id resolvable to a passage.

**Grounded or silent (FR-D2)** is enforced structurally, not by prompt: the planner returns citations as a *field*, and a document-derived answer with an empty citation list is rejected by the same validation pass that corrects action labels. Prompt instructions are advisory; a field the code checks is not.

### Interface
- **Composer becomes a drop target** with attach and camera affordances — the entry point for Phases B and C, which does not exist in any form today
- **Ingestion is visible**: screening → indexing → ready, with blocked stating why in words
- **Citations are chips inline**, opening the passage in the Canvas with the source highlighted (R3)
- **A document library** in Profile, with per-document delete and a plain statement of what deletion removed
- **Mobile:** camera capture and read/approve. Long-document work is desktop (R2)

### Requirements met
FR-D1 … FR-D5. Manifest §4.

### How it is proven
- **Adversarial:** a PDF containing an injection is blocked, and the block never quotes the payload
- **Isolation, as a release gate rather than a test.** Two seeded users with deliberately similar documents, then:
  - B's retrieval returns zero of A's chunks
  - B's retrieval **with the field filter removed in the test** still returns zero, proving layer 1 holds alone
  - a hand-built path to A's collection is rejected by the scope token (layer 4)
  - a forged chunk carrying A's `ownerUid` is caught by the post-retrieval assertion (layer 5)
  - `scripts/check-tenant-isolation.py` fails a branch that introduces a `collectionGroup` query

  Each layer is tested **with the layers above it disabled**. Testing seven controls together proves only that at least one of them works — which is precisely what you do not want to discover during an incident.
- **Grounding:** an evaluation set of ~30 question/passage pairs over a real contract; measure citation accuracy *before* claiming the feature works, exactly as the model pin and the action-labelling gap were measured
- **Deletion:** delete → the chunk is unretrievable → the blob is gone
- Load: a 40-page PDF ingests within a stated budget, and the UI shows progress rather than appearing hung

### What could go wrong
- **Cross-tenant retrieval** — no acceptable rate. Seven layers (§1.4), each tested with the others disabled.
- **Confident wrong answers** — the worst *quality* failure available. Mitigated by structural grounding, and by measuring before shipping
- **Cost of embedding large uploads** → per-plan document limits already in `libs/metering`; enforced at upload, not at query
- **Chunking destroying meaning** in tables → the Document AI escalation in §3.2, triggered by the evaluation set rather than by taste

---

## 6. Phase C — Multimodal

### Goal
See what the user shows it; show them what it means; remember their taste.

### Data model

```
users/{uid}/visualPreferences/{prefId}
  facet: palette|density|radius|tone|typography
  value, derivedFrom: artifactVersionId, correction
  createdAt, revertedAt

artifacts/{id}/versions/{n}          (extends Phase A)
  generation: { model, prompt, appliedPreferences[], seed }
  provenance: { c2pa: true, synthId: true }
```

`appliedPreferences` is recorded per version so a user can see *why* an image came out the way it did — and so "undo that preference" has something concrete to undo.

### Services & infrastructure
- **connector-gateway** gains a `media` connector: `generate_image`, `draft_video`, `render_video`
- Registry severities: `generate_image` → `CREATE_TASK`, `draft_video` → `CREATE_TASK`, `render_video` → **`MAKE_PAYMENT`**
- `roles/aiplatform.user` already held. The media models are `global`-only, so **`MEDIA_LOCATION` is a separate variable from `GOOGLE_CLOUD_LOCATION`** — collapsing two regions into one variable is precisely what broke voice, and it is not repeated
- Generated bytes land in the Phase A artifact bucket; no second store
- **Gemma screener** added to `libs/screening` as a third layer, wired into `librarian` and `watcher-runtime`
- Metering: `IMAGES`, `DRAFT_VIDEO_SECONDS`, `FINAL_VIDEO_SECONDS` already exist in `libs/metering`

### Interface
- **Every generated image is labelled as generated, always** (FR-M1); C2PA/SynthID preserved through storage and export
- **Cost disclosed before spending**, in plan units — "about 15 seconds of your Max allowance", never in dollars (R6)
- **A final render takes a second confirmation.** It costs roughly fifteen times a draft, and one stray click is £5
- **Visual preferences as swatches**, individually revertible (R3, FR-M4)
- **Mobile is camera-first** — the most natural capture surface the product does not have (R2)
- Degrades to a described layout rather than failing the turn (FR-M5)

### Requirements met
FR-M1 … FR-M5, FR-S1 … FR-S3. Manifest §5, §5A.

### How it is proven
- C2PA/SynthID survive storage and export — **verified on the bytes**, not assumed from the API response
- A watcher cannot trigger video at any ceiling, **including with a valid org waiver** — asserted directly, because the waiver path is the one that could bypass a ceiling
- Gemma catches a paraphrased injection the regex layer misses, and does **not** block "ignore my earlier email" — the false-positive case `libs/screening` already guards
- Cost disclosure and metering are computed from one source, so they cannot disagree
- Brand memory: correct an image twice, regenerate, assert both corrections applied

### What could go wrong
- **Video cost runaway** → `MAKE_PAYMENT` severity, double confirmation, zero on Free, no watcher access
- **Gemma latency on every page** → run in parallel with Model Armor, never in series; the composition rule makes ordering irrelevant to the verdict
- **Brand memory over-applying** where the user wanted something plain → per-artifact override, and the override is itself a correction
- **`global`-only media models** widen the residency gap → confined to generated media (§3.1), and stated to the user rather than discovered

---

## 7. Phase D — Meetings: Tier 2 by default

**Per direction: Tier 2 is the default.** The design below makes that safe rather than aspirational, because the refusal conditions are real and outside our control.

### Goal
Be useful about a meeting without being a bot nobody invited — attempting live participation first, every time.

### 7.1 What Tier 2 actually is

Meet Media API. A **receive-only** WebRTC client consuming audio, video and participant metadata:

- The offer must include **exactly three receive-only audio media descriptions**, and one to three video
- Required ordered data channels: **session-control** and **media-stats**
- Developer Preview: the Cloud project, the OAuth principal **and every participant** must be enrolled
- Refused with underage accounts, encrypted meetings, or watermarked meetings
- A consenting host must be present, and **every participant sees an initiation dialog**

**The agent listens. It cannot speak.** The API does not transmit, and the product must never imply otherwise (FR-C4).

### 7.2 Default, with a fallback ladder

"Tier 2 by default" means *attempt Tier 2 first, always* — not *require it*.

```
1. Attempt Tier 2 (Meet Media API)
      ├─ connected  → live notes, running plan, in-call
      └─ refused    → record the exact reason, fall to 2
2. Tier 1 (Meet REST + Workspace Events)
      ├─ transcript after the call → plan through the same gates
      └─ unavailable → fall to 3
3. Say so plainly, with the reason
```

**Silent in the moment, explicit afterwards.** Nobody wants an error dialog during a client call; everybody wants to know afterwards why there are no live notes.

This honours the instruction rather than diluting it: Tier 2 *is* attempted every time. The ladder is what stops "Tier 2 by default" becoming "Tier nothing by default" on the many meetings the preview refuses.

### Data model

```
users/{uid}/meetings/{meetingId}
  spaceName, conferenceId, startedAt, endedAt
  tier: 2|1|none
  tierReason                      <- why Tier 2 was refused, verbatim
  participants[], transcriptRef
  screening: { verdicts[] }
  status: listening|processing|ready|blocked

users/{uid}/meetings/{id}/notes/{n}
  at, speakerLabel, text, isCommitment
```

`tierReason` is stored **verbatim** rather than mapped to a code. The refusal conditions belong to a preview programme we do not control, and an unmapped string is what will tell us which ones actually happen in practice.

### Services & infrastructure
- New service **`scribe`** (Node/TypeScript — the reference client is TypeScript; the alternative is C++)
- **A WebRTC session pins an instance for the meeting's duration** — the same arithmetic as the voice relay, so `min_instances`, concurrency and max-instances are set deliberately rather than defaulted
- Workspace Events subscription for Tier 1 lives in the same service: one service owns meetings, whichever tier serves them
- Meet scopes added to the consent flow already built for connectors
- Invoker graph: `scribe` is called by the gateway and calls the orchestrator
- Bootstrap: `backend_services` gains `scribe`, exactly as it gained `registry` — a service absent there has no runtime identity and its first deploy fails

### Interface
- **A persistent, visible listening indicator** for the entire time the agent is connected — ours, in addition to Meet's own participant dialog
- **Per-meeting opt-out that survives the default**, plus a global off switch (FR-C3)
- The meeting record **states which tier served it, and why** if Tier 2 was refused
- Commitments render as proposals with a confirm step, never as done (FR-C2)
- **Mobile:** read the notes, approve the commitments. Nobody edits a transcript on a phone (R2)

### Requirements met
FR-C1 … FR-C4. Manifest §6, with the tier default inverted per direction.

### How it is proven
- Tier 2 against a real hosted meeting: joins, receives audio, produces notes
- **Each refusal path exercised deliberately** — a non-enrolled participant, an encrypted meeting — each falling to Tier 1 with the reason recorded
- Tier 1 end to end: subscription fires, transcript fetched, screened, planned
- An injected instruction inside a transcript is blocked and never reaches a model
- A commitment sends nothing until confirmed
- **A 60-minute meeting does not drop**, and reconnection resumes rather than restarting

### What could go wrong
- **The preview programme does not relax, or is withdrawn** → Tier 1 is sufficient alone, so the product is never blocked on a programme we do not control
- **Instance pinning cost** on long meetings → concurrency and max-instance limits set deliberately, and metered
- **Transcription quality across 97 languages** → measured, not assumed, on the same surface voice already uses
- **A user believes the agent can speak** → never claimed (FR-C4), and the indicator is explicitly passive
- **Three audio streams, many participants** → speaker attribution is best-effort and labelled as such, never presented as certain

---

## 8. Phase E — Co-work

### Goal
Get the work to another person without leaving the product.

### Scope, deliberately narrow
**Share → comment → resolve.** Async, permissioned, audited. **Not** live multiplayer editing, cursors or CRDTs — a large build with a large failure surface, and not what the manifest's 16:20 moment needs.

### Data model

```
artifacts/{id}/shares/{granteeUid}
  role: viewer|commenter, grantedBy, grantedAt, revokedAt

artifacts/{id}/comments/{commentId}
  authorUid, versionAnchor: n     <- anchored to a VERSION, not the artifact
  body, resolved, resolvedBy, at

users/{uid}/digest/{yyyy-mm-dd}
  ranWatchers[], awaitingDecision[], artifactsChanged[], sentAt
```

**Comments anchor to a version.** A comment on v2 must not silently reattach to v5 and appear to be about text nobody wrote.

**Shares live under the artifact, not under the user** — the one deliberate exception to §1.4's path rule, because a share is a property of the shared thing. It grants exactly one artifact and **never widens retrieval** (FR-D4e); the corpus stays single-user permanently.

### Services & infrastructure
- Gateway routes: `POST/DELETE /api/artifacts/:id/shares`, `GET/POST /api/artifacts/:id/comments`, `POST /api/comments/:id/resolve`
- Firestore rules extended: readable if `ownerUid == uid` **or** an unrevoked share exists
- Digest: Cloud Scheduler → Pub/Sub → the existing watcher-runtime push path, reusing machinery rather than adding a service
- Web push via Firebase Cloud Messaging; the PWA service worker already exists
- Metering: sharing is Team and above, enforced at grant time

### Interface
- **A role grant, never a public link.** A link that works for anyone holding it is a different security model from the rest of this product
- Comments appear in the same Transparent Trace as everything else
- The digest is **glanceable and actionable from a phone** — the manifest's 07:40 moment (R2)
- Revocation is immediate, and visible to the grantee

### Requirements met
Manifest §7.4 and §7.2 (digest). FR-D4e.

### How it is proven
- A share grants exactly the role given: a **commenter cannot edit, a viewer cannot comment**
- Revocation takes effect immediately — asserted, not inferred from rule syntax
- **A shared artifact does not make its source chunks retrievable by the grantee** — the FR-D4e gate
- The digest's counts reconcile with the ledger; a digest that disagrees with the record is worse than none
- Push arrives on a real device, and the notification is actionable rather than a bare title

### What could go wrong
- **Sharing widening into retrieval** — the most plausible way §1.4 gets undone. Guarded by an explicit test, not by care
- **Digest noise** training users to ignore it → send only when something needs a decision, never a daily "nothing happened"
- **Comment anchors drifting** across versions → anchored to a version id, and an orphaned anchor reads as "on an earlier version" rather than silently moving

---

## 9. Phase F — Specialists & recovery

### Goal
Make capability legible, and make every failure survivable.

### Data model

```
specialists/{specialistId}          (configuration, not user data)
  label, agentId, cardVersion, skills[], description

users/{uid}/recoveries/{id}
  turnId, failureKind, routeOffered, routeTaken, at
```

Recoveries are recorded because **which route a user takes after a failure is the most honest product feedback available** — it says what they actually wanted when the system could not deliver.

### Services & infrastructure
- **No new service.** Specialists are a view over the existing registry, which already holds agents, owners, skills and signature status
- The registry earns a second job: governance surface *and* product surface
- Recovery routing is a gateway concern — it owns the error taxonomy already

### Interface

Every failure gets a route forward:

| Failure | Route |
|---|---|
| Model unavailable | retry · continue in text · try later |
| Connector not connected | connect now · do it manually · skip this step |
| Plan limit reached | what remains · upgrade · wait for reset |
| Screening blocked | why, in words · use a different source |
| Meet refused | which tier served it instead, and why |
| Retrieval found nothing | say so · search differently · add a document |

**A failure with no route is where trust is lost**, because the user's only remaining move is to leave.

Specialists appear as named capabilities — **Document guide, Design partner, Meeting scribe, Researcher** — each showing its card version and signature status, so the governance work becomes visible rather than merely present.

### Requirements met
Manifest §7.5 and §9.4. The fifth agent-UX pattern from §2.1.

### How it is proven
- Every entry in the failure taxonomy has a route, asserted **exhaustively** — a new failure kind without a route fails the test, which is what stops this decaying
- A specialist's displayed card version matches what the registry reports
- An unverified card is visibly unverified in the specialist view, exactly as in the Agents screen
- Browser: each route is keyboard-reachable and announced to a screen reader

### What could go wrong
- **Routes that do not work** — offering "retry" that fails identically is worse than offering nothing. Each route is tested to actually resolve its failure
- **Specialist theatre** — naming four specialists that are one prompt behind the scenes. They must differ in skills and tools, or they are marketing
- **Taxonomy drift** as new failures appear → the exhaustiveness test is the guard

---

## 10. Phase G — Meetings Tier 2, hardened

### Goal
Move Tier 2 from *works* to *dependable*. Separated from Phase D because "it works" and "it holds up for ninety minutes on hotel wifi" are different engineering problems, and conflating them is how the second one gets skipped.

### Data model

```
users/{uid}/meetings/{id}/health/{sampleId}
  at, rtt, jitter, packetLoss, reconnects, streamGaps
```

Session health is stored, not merely logged, because the question after a bad meeting is "what happened *in that meeting*" — and a metric you cannot join to a meeting id cannot answer it.

### Services & infrastructure
- Reconnection with backoff and **session resumption**, not restart — the same lesson as the voice relay, whose reconnect was found unbounded and fixed
- Cloud Run concurrency and max-instances tuned against measured session counts rather than guessed
- Cost controls: a per-meeting duration cap with an explicit extend, so a forgotten meeting cannot bill indefinitely

### Interface
- **Connection quality visible during the meeting**, honestly — degraded notes are better than confident wrong ones
- A gap in coverage is stated in the notes ("no audio 14:02–14:05") rather than silently omitted
- Extending past the duration cap is a decision the user makes, with the cost shown

### Requirements met
Manifest §6 at production quality. FR-C3's visibility requirement under real conditions.

### How it is proven
- **A 90-minute meeting on a deliberately lossy connection** produces continuous notes, with gaps labelled
- Forced disconnection mid-meeting resumes rather than restarting, and notes do not duplicate
- Speaker attribution measured with more participants than the three audio streams
- Cost per meeting-hour measured against the plan allowance
- Chaos: kill the instance mid-meeting; the user sees a truthful state, never a frozen one

### What could go wrong
- **Silent degradation** — the worst outcome here, because notes that look complete but are not will be trusted. Every gap is labelled
- **Reconnect storms** on a flapping connection → bounded attempts with backoff, reusing the pattern already in the voice relay
- **Cost of long meetings** → duration cap with explicit extend

---

## 11. Shipping safely: flags, rollback, migration

Seven phases will land over months, into a product with live users. How each one arrives matters as much as what it contains.

### 11.1 Every phase ships behind a flag

Each phase is gated by a per-user capability flag stored beside the subscription, and read the same way entitlements are:

```
users/{uid}/capabilities
  artifacts, documents, multimodal, meetings, cowork, specialists
    : off | internal | beta | on
```

**Not a global boolean.** A global switch has two states, and the interesting state — "on for forty people who agreed to it" — is neither. The progression is `off → internal → beta → on`, and a phase does not advance until the previous cohort's evidence says it should.

**The flag is read server-side, never trusted from the client.** A capability flag that the browser asserts is a capability flag an attacker asserts. It resolves in the gateway from the same document that resolves the plan tier, and the UI merely reflects what the server returned.

**Default is off, including for existing users.** A user who has never seen a canvas should not discover one because a deploy landed. New capability arrives as an announcement, not a surprise.

### 11.2 Rollback

The Cloud Build deploy already makes image rollback a one-liner: images are tagged with the commit SHA and never `:latest`, so rolling back is `deploy the previous tag` rather than an archaeology exercise. That covers code.

It does not cover the two things that actually hurt:

**Schema.** Every phase adds collections; none modifies an existing one. That is deliberate — **additive-only migrations are what make rollback possible at all.** A phase that needed to change `sessions` or `preferences` would be a phase whose rollback plan is "restore from backup", which is not a plan.

**Data written by a rolled-back feature.** If Phase B ships, ingests documents, and is then rolled back, those documents still exist. So each phase's flag has a defined off-state behaviour:

| Phase | Flag off, data exists |
|---|---|
| A Artifacts | artifacts hidden, retained, exportable on request |
| B Documents | retrieval disabled; documents remain and remain deletable |
| C Multimodal | generation disabled; existing images stay in their artifacts |
| D Meetings | subscription cancelled; past meeting records retained |
| E Co-work | shares suspended, not deleted; grantees lose access immediately |
| F Specialists | falls back to the single general agent |
| G Hardening | no user-visible state |

**Suspended, not deleted**, in every row. A rollback that destroys user data is worse than the bug that caused it.

### 11.3 Migration for existing users

**There is none, by design.** Every phase adds collections under paths that do not exist today. No backfill, no dual-write, no read-repair, no migration window.

The one thing that does need care is the **artifact backfill question**: should existing sessions retroactively get artifacts? The answer is no. A plan produced before artifacts existed was not produced *as* an artifact, and inventing versions for it would fabricate a history that never happened — in a product whose central claim is that its history is real.

Existing sessions stay as they are. The first artifact is the first one actually made.

### 11.4 Internationalisation

The product speaks 97 languages in voice and **its interface is English only.** v3 makes that gap worse, because documents, meeting notes and generated images are all content a user will bring in their own language.

The honest position, stated rather than left implicit:

- **Content is multilingual now.** Documents can be in any language the embedding model handles (verified: cross-lingual retrieval works, with a thin margin — §3.1). Meeting transcripts follow the voice surface's 97 languages. Generated image text rendering is model-dependent.
- **The interface is not**, and v3 does not fix it. Externalising strings across seven new surfaces is a phase of its own, and doing it badly — half-translated, with English error states — is worse than not starting.
- **What v3 must not do is make it harder.** Every new surface uses sentence-case, avoids concatenated fragments, and keeps user-visible text out of logic. That is the cheap discipline that turns i18n from a rewrite into a task.

**Recorded as open question 7** rather than silently deferred.

### 11.5 Third-party dependency risk

New external surfaces, and what happens when each fails:

| Dependency | Failure mode | Answer |
|---|---|---|
| Meet Media API | preview withdrawn or not relaxed | Tier 1 is sufficient alone (§7.2) |
| Veo | price change or deprecation | ladder is three models; the tier can move down it |
| Nano Banana 2 Lite | model retired | it already replaced a legacy model; the seam is one call |
| Model Armor | outage | fails closed; Gemma layer still runs, and blocks alone |
| Firestore vector search | scale limit | documented revisit point at ~10k chunks per user (§3.1) |

**No single external dependency has a failure mode that stops the product.** That is checked here rather than assumed, because it is the property most likely to be quietly untrue.

---

## 12. Cross-cutting: security and privacy review

Each phase ships with a written answer to all five. No phase is done without them.

1. **What new untrusted content enters, and where is it screened?**
2. **What new data is stored, where, and how is it deleted?**
3. **What new IAM grant is made, and is it the narrowest that works?**
4. **What new cost can be incurred, and who can incur it unattended?**
5. **What does the user see about all of the above?**

**New personal data in v3 is materially more sensitive than v2's.** Contracts, meeting transcripts and photographs are the user's actual working life. Specific commitments:

- Documents and transcripts are **per-user encrypted at rest by default** (CMEK-ready), deletable, and their deletion removes derived embeddings — not just the source
- A meeting transcript is **never used to train anything**, and the product says so where the user can see it
- Retention is stated per data type, in the interface, in words

---

## 13. Observability and SLOs

Defined before optimising, per the roadmap's own Phase 9 rule:

| Metric | Target | Why this one |
|---|---|---|
| Document ingest p95 | < 60s for 40 pages | the manifest's 09:15 moment |
| Grounded answer citation accuracy | > 95% on the evaluation set | FR-D2 is the trust anchor |
| Image generation p95 | < 8s | conversational, or it is not a loop |
| Meet Tier 2 join success | measured, not targeted at first | we do not control the refusal conditions |
| Meet Tier 1 transcript → plan | < 5 min after call end | "it was across the whole call" |
| Screening false-positive rate | tracked per layer | a screen everyone disables protects nobody |

**Meet Tier 2 join success is deliberately unset.** Setting a target for something governed by a preview programme's enrolment rules would be inventing a number. Measure first, target once there is evidence.

---

## 14. Sequencing and estimate

```
A. Artifacts & Canvas        ██████            2 wks   substrate for everything after
B. Documents & Retrieval     ██████████        3 wks   needs A
C. Multimodal                ████████          2.5 wks needs A; Gemma layer lands here
D. Meetings (Tier 2 default) ████████████      3.5 wks needs B for screening; independent of C
E. Co-work                   ██████            2 wks   needs A
F. Specialists & recovery    ████              1.5 wks cross-cutting, can run alongside E
G. Tier 2 hardening          ██████            2 wks   needs D, and real usage
```

**≈ 16.5 weeks sequential; ≈ 12 with C ∥ D and E ∥ F.**

**A is non-negotiably first.** Everything after it produces artifacts, and building any producer before the thing it produces means building it twice.

---

## 15. Open questions

1. **Currency.** Max is written as £60 to match the existing pence-denominated tiers; the instruction said $60. Converting all four tiers is a code change in `libs/metering`, not a doc edit.
2. **Team final-render allowance.** 10s/seat is $7.50 of cost inside £32 — the tightest ratio in the table. Possibly better at zero.
3. **EU residency, now narrower.** Nano Banana 2 Lite and Veo are `global`-only; `europe-west1` 404s on both. But **embeddings are available in `europe-west1`**, so the user's document corpus — the most sensitive data v3 introduces — stays in region. The residency gap is confined to *generated media*, which is a far easier thing to accept or to route around than a corpus. Still an explicit decision, but a smaller one than it looked.
4. **Meet Developer Preview enrolment** — who owns getting the org and its meeting participants enrolled, and what the answer is for external attendees.
5. ~~**Embedding model and dimensions**~~ — **settled: `gemini-embedding-001` at 1536 dimensions, `europe-west1`.** Verified against the project; the 3072 default would have exceeded Firestore's cap. Truncation and cross-lingual behaviour were measured (§3.1). Remaining sub-question: whether the thin cross-lingual margin needs query translation, which Phase B's evaluation set answers.
6. **Payment provider** — deferred pending PM validation; metering and enforcement are complete and provider-agnostic.
7. **Interface internationalisation.** The product speaks 97 languages and its UI is English only. v3 widens the gap without closing it (§11.4). A phase of its own, and it should be scheduled rather than left to accumulate.

---

*Every model id, region and limit in this plan was verified against `alltheway-rinegan` where a probe was possible, using an invalid payload so that a live model refuses rather than bills. Where verification failed — the embedding models, whose probe returned 401 on an expired token — it is marked as unverified rather than reported as fact.*
