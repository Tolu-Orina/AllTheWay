# profile-synthesizer

Consumes `session.ended` and writes what was learned into the Cognitive Profile.

```bash
python -m uvicorn app.main:app --port 8092
python -m pytest tests -q
```

## Deliberate choices

**Deterministic, not model-driven — for now.** A correction already contains
both halves of what was learned (what was proposed, what the user changed it
to), so a model call here would add nondeterminism to a step that has none. The
model earns its place later, generalising *across* many corrections rather than
restating one.

**Reverted preferences do not count as evidence.** A revert means the user
rejected that inference, so it must not strengthen the case for repeating it.

**The handler excludes its own row from the evidence count.** Without this, an
at-least-once redelivery counts the preference the previous delivery wrote and
inflates the evidence on every retry — "4 times", "5 times" — for a correction
the user made once. This was a real bug, caught by delivering the same event
twice.

**A no-op teaches nothing.** Identical or empty before/after returns no
preference, rather than padding the profile with something the user never did.

**A new correction under the same key retires the old row.** Two opposite
facts both injected is worse than no memory. Independent facts in the same
area keep distinct keys. Evidence counts same-key rows, not every preference
the user has.

**Watchers do not write here.** Untrusted external content is not evidence
about the user. The only writer of a human row is a correction on a session.

**Sleep-time generalisation is a new row.** After a session learns, a second
pass looks *across* keyed human rows in the same area and hat. Two
independent shortenings become a proposed `source: "synth"` row, still
revertible, not injected until accepted or until confidence crosses 0.6.
A human `session-*` row is never overwritten.

**Memory Bank is an optional extractor, not the profile.** When
`MEMORY_BANK_RESOURCE` is unset the extractor is not called. When set, it
retrieves `USER_PREFERENCES` only and lands facts as proposed rows. It does
not call GenerateMemories, and school-run chat is not a source.

