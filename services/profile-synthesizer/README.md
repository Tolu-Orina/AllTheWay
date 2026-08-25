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
