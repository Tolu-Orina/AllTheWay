# AllTheWay — Memory Layer Plan

**Status:** Phases A–D implemented (2026-08-28) · **Companion to** Product Manifest v3 §3.1–3.2, Life Companion Design, Technical Architecture §3.5  
**Research basis:** Always-On Agents survey (June 2026), TEPA (Aug 2026), MemGuard (Aug 2026), Vertex Memory Bank topics/TTL, Claude per-project memory, ChatGPT Dreaming (June 2026)

This is the plan that makes “one companion, one memory” true after the product got wider, without bolting on a fourth memory product.

---

## 0. The decision that everything else follows

**The Cognitive Profile is a Firestore ledger, not Vertex AI Memory Bank.**

That is what is deployed. Architecture, the roadmap, and the marketing “Built on” row previously said otherwise. The mismatch is the coherence failure: later work was planning against a system that does not exist.

Memory Bank is **not** the profile. Reasons, in order:

1. AllTheWay’s differentiator is **inspect, evidence, revert**. Memory Bank’s extraction is a black box; ChatGPT’s “Dreaming” (June 2026) is the same shape and has no export. Adopting it as the store would trade the moat for a vendor feature we cannot show on You.
2. TEPA (Aug 2026) shows that stale *active* memory is worse than no memory. Our `revertedAt` stamp is already the right primitive. Memory Bank consolidates in place; it does not give us a user-visible revoke.
3. Working memory (documents) already has a retrieval path. Putting preference strings into a second vector store would quietly merge the two memories v3 split on purpose.

**Memory Bank is an optional extractor** behind the same ledger, gated on `MEMORY_BANK_RESOURCE`. When that variable is unset, the extractor is not called. When set: topics restricted to `USER_PREFERENCES`, never `USER_PERSONAL_INFO` from school-run chat, writes landing as proposed rows the user can still revert. GenerateMemories is not invoked from transcripts. Marketing “Built on” does not name Memory Bank until the extractor is actually invoked in production.

Working memory stays the librarian. Life entities stay people/places/rhythms. Brand memory stays `visualPreferences`. One identity, four stores, each with a job.

---

## 1. What “properly implemented” means

A memory layer is proper when all of these are true at once:

| Obligation | 2026 name | AllTheWay |
|---|---|---|
| Something is written from real use | admission | `session.correction` on Not quite; synthesizer keys the row. |
| A later turn can see it | retrieval / injection | Standing, non-proposed rows; unlabeled plus active hat. |
| A contradicted fact stops being retrieved | TEPA revoke | New correction under the same key (and hat) stamps `revertedAt`. |
| The user can see and undo it | recoverability | You screen + revert. Proposed synth rows need Accept. |
| Watchers cannot mint profile facts from stranger text | authority / source | Watchers read prefs, do not write. |
| Work and home do not silently mix | scope | Optional `hat` on prefs and documents. Default unlabeled. |
| The third explanation differs from the first | struggle / adaptability | `concepts` written on reask and miss only. |
| Voice planning sees the same context as text | one companion | `plan_turn` uses `loadTurnContext`. |

Phase A closed admission, revoke, recoverability, and the voice gap. B, C, and D close scope, struggle, and sleep-time.

---

## 2. The four memories, kept apart

v3 was right: **injection does not scale and retrieval does not personalise.** Life then added a third family. Studio added a fourth. The mistake was letting the Cognitive Profile *claim* to be all of them.

| Store | Path | Reaches the model by | Grows by | User control |
|---|---|---|---|---|
| Preference | `users/{uid}/preferences` | every prompt, standing rows only | a human correction | revert |
| Working | `users/{uid}/documentChunks` | per-turn retrieval | upload | delete the document |
| Brand | `users/{uid}/visualPreferences` | media generate, at the gateway | an artifact correction | revert |
| Life | `people` `places` `rhythms` `reminders` | Today + calendar lookups, not the profile | capture | delete the entity |

Watchers, voice, and text **read** preference memory. Only a human correction **writes** it. That is the source-weighting Phase 2 of the Production Roadmap asked for, implemented as an absence rather than a score: there is no watcher writer to under-weight.

---

## 3. Phase A — Close the loop (this delivery)

### Goal

A person can correct the companion, see the fact on You, and have the next plan and the next image use it. A later opposite correction retires the previous fact without deleting the record.

### 3.1 Correction is a first-class decision

`POST /sessions/:id/decision` already accepts `kind: "corrected"` and writes the ledger. It did not write `session.correction`, so the synthesizer had nothing to learn.

**Change:** `kind: "corrected"` requires `now`. `summary` is what was proposed (`was`). The gateway:

1. Records the ledger row (unchanged: append-only, modality field, no separate voice memory).
2. Writes `session.correction = { was, now }`.
3. Publishes `session-ended` immediately, so the next turn in the *same* session can see it. Session-end on leave remains idempotent: the preference document is still `session-{sessionId}`.

Decline does not learn. “Don’t do this” is not a preference about how to do it. Confirm does not learn. Agreement is not a correction.

### 3.2 The synthesizer keys and revokes

Still deterministic. A correction already contains both halves. A model here would add nondeterminism to a step that has none.

**Keying (TEPA, single-hop):**

- Continuation: new `was` equals an active row’s `now` → same key.
- Same proposal: new `was` equals an active row’s `was` → same key.
- Otherwise: `area:{area}:{sha256(normalised was)[:12]}`.

Independent Navigation facts do not collide. A reversal of the same fact does.

On write: stamp `revertedAt` on every other standing row with that key. The new row is the active precedent. History stays. You still lists only `revertedAt == null`.

Evidence counts **same key**, not every preference the user has. A Writing correction must not say “you have made this change 7 times” because they also trimmed a sidebar.

### 3.3 Brand memory actually writes

Artifact versions already store `correction`. Nothing read it.

On a non-empty correction note after a version appends: classify aspect (palette / density / corners / typography / look), extract hex swatches if present, write `visualPreferences`, revoke the previous active row of that aspect.

Applied at generate time, inside the connector gateway, as today. A caller still cannot pass someone else’s style.

### 3.4 Voice planning is the same companion

Live chit-chat stays a Live-model session with a fixed instruction (language rules are load-bearing; stuffing the profile into it would fight them).

The moment it calls `plan_turn`, the gateway fetches **preferences, passages, lookups, and thread** — the same four as a typed turn. A spoken “what’s in the contract” that plans must not be dumber than the typed one.

### 3.5 Interface

Confirm gate grows a third path, **Not quite**, which is the learning signal:

- Yes → confirmed (acts).
- No → declined (nothing runs, nothing learned).
- Not quite → the person says what it should have been; that is `corrected`, then a new turn replans from their words.

Typing in the composer during confirm is the same path. The placeholder already invited it (“Answer above, or type something else”). That something else is now a correction, not a mysterious new request with the old proposal still active.

### 3.6 Docs honesty

- This file is the memory contract.
- Technical Architecture §3.5 and principle 2 are amended: Firestore is authoritative for preferences; librarian for working memory; Memory Bank deferred.
- Marketing “Built on” drops Vertex AI Memory Bank until it is actually called.

### Requirements met

FR-V3 (one profile, no voice memory) holds. FR-V5 (ledger structure) holds. Manifest v3 §3.1 (two memories) is kept. TEPA validity is the `revertedAt` stamp, now also applied on supersession.

### How it is proven

- Synthesizer: no-op, chain, independent keys, reverse, evidence scoped to key, redelivery does not inflate (existing own-id exclusion).
- Gateway: `corrected` without `now` is `correctionFields` `"missing_now"` (the route's 400); with a real `now` writes the session field. `listPreferences` omits `revertedAt != null`.
- Visual: “too much blue” → palette; “softer corners” → corners; empty note writes nothing; second palette correction revokes the first.
- Turn payload: `assembleTurnContext` plus `buildMessage` — the A2A metadata carries passages, lookups, preferences, and thread; none of them are concatenated into the user's text. Does not open a Live socket.

### What could go wrong

| Risk | Mitigation |
|---|---|
| Two phrasings of the same fact become two keys | User reverts the stale one. Phase B may add a model *across* keys, never instead of a key. |
| Publishing `session-ended` on every correction fans out `session_ended` watchers | Those watchers already fire on leave. Firing on correction is “a piece of work changed what we learned.” Acceptable. If a watcher is too chatty, it is a watcher bug, not a reason to skip learning. |
| Brand classifier mis-tags | Aspect is visible on You and revertible. Wrong look is cheaper than no look. |
| Locale guard | New strings added in every catalogue, not English-only. |

---

## 4. Phase B — Hat-scope (implemented)

Claude shipped per-project memory isolation. v3.5 asked that work and home not contaminate each other.

**Do not split into two products.** An optional `hat` on preference rows and on document retrieval.

- Default `null` = applies everywhere.
- A correction made while Today is filtered to `home` stores `hat: "home"`. The gateway reads the **server** hat (`users/{uid}/settings/hat`), not a client-supplied field.
- Injection includes unlabeled rows plus the active hat. Viewing All includes labelled rows too.
- Retrieval takes an optional hat filter only after documents themselves carry one (upload picker). Unlabelled documents always retrieve.
- Filename is not a hat. There is no `hat_for_title`. A school policy uploaded without a picker stays unlabeled.

Synthesizer keys include hat, so a work fact and a home fact of the same words do not revoke each other.

Quiet hours per hat stay a Today concern. They are not memory.

### How it is proven

- `appliesHat`: unlabeled applies under every hat; All includes labelled; home excludes work.
- `parseHat("school")` is null, not a guessed hat.
- Synthesizer: work and home of the same words keep distinct keys and do not revoke each other.
- Librarian: `hat_for_title` does not exist.

---

## 5. Phase C — Struggle model (implemented)

`users/{uid}/concepts/{id}` is not a prompt instruction.

Per concept: `encountered`, `reasked`, `reexplained`, `confidence`, `lastSeenAt`, `documentId`, `label`. Visible and revertible on You next to preferences.

Writers: **reask** (Explain again on a citation) and **miss** (I didn’t get it). A hit raises confidence on an existing row and writes nothing if there is no row. Opening the citation sheet does not write. No dwell-time inference.

The third explanation must differ: struggles travel as A2A metadata and land in the system context, never concatenated into the user’s message.

Marketing still must not claim a tutor it does not have. The writers exist; a quiz product does not. The true claim remains inspectable memory, plus “the next explanation of this should differ.”

### How it is proven

- Same clause, same document → one concept id, case-insensitive.
- Graph: `STRUGGLES` is in the system context, not the user message.
- Turn payload: `struggles` on A2A metadata; empty by default.

---

## 6. Phase D — Sleep-time synthesis (implemented)

Letta’s sleep-time and ChatGPT Dreaming are the same job: generalise *across* many corrections (“you consistently shorten things”).

A Generator/Critic loop that restates one `was`/`now` is still theatre. What landed is a deterministic pass after a session learns:

- At least two independent **session** keys in the same area and hat, where `now` has fewer words than `was`.
- A *new* row with `source: "synth"`, never a `session-*` id, never an overwrite of a human row, still revertible.
- MemGuard-style confidence: `min(0.9, 0.35 + 0.1 * n)`. Below 0.6 the row is `proposed` and is not injected until the person accepts it on You.
- Work and home are different groups. Two mixed-hat shortenings do not become one pattern.
- An existing synth row in that group is not duplicated.

Memory Bank, when `MEMORY_BANK_RESOURCE` is set, retrieves `USER_PREFERENCES` only and lands facts as always-proposed, unlabeled rows. Personal-looking facts (child, school run, SSN-like) are dropped. When unset, the extractor returns `[]` and is not called.

---

## 7. What this plan refuses

- **Mem0 / Zep / Letta as the profile.** Wrong trust story (update-in-place or a different runtime).
- **Watchers writing preferences.** Untrusted external content is a prompt-injection vector; it is not evidence about the user.
- **Merging documents into preference injection.** That is how RAG went missing the first time.
- **Kids’ memory.** Life design: children are people in her account, not profiles.
- **Silent transcript training.** Voice transcripts remain opt-in and are not a synthesizer source.

---

## 8. Fitness function

A new account:

1. Talks through a nav plan, is asked to confirm, says **Not quite** and “four items, collapsed.”
2. Leaves the session (or the correction itself publishes).
3. You shows one Navigation preference with evidence “You changed this once.”
4. A second session’s plan is told that fact.
5. They correct it the other way. You shows one standing row, not two opposites. The first row is still in Firestore with `revertedAt` set.
6. They generate an image, say “too much blue,” generate again; the second still is constrained. You shows a palette row they can revert.

If any of those fail, the memory layer is not implemented, however many collections exist.

Phases B/C/D add, they do not replace:

7. Today filtered to Home, a correction stores `hat: "home"`. A Work-labelled document does not retrieve. An unlabeled document still does.
8. Explain again on a citation writes one concept on You, revertible. The next plan is told that the third explanation must differ.
9. Two independent Writing shortenings produce a **suggested** row, not an injected one. Accepting it injects it. Reverting it retires it.

