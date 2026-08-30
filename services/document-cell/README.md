# Document cell

A bounded leaf, the same shape as the research cell: one call after Yes,
workers invisible, bounds in code, degrade instead of looping.

It is **not** a second product orchestrator. The turn graph still plans.
The person still confirms. After Yes this service:

1. **Worker** generates stills once from the confirmed brief (prompt hash).
2. **Planner** (Gemini 3.7 Flash, fresh call) edits retrieved boxes around
   those pixels. Code repairs overlap and snaps chrome.
3. If structure fails: skip LibreOffice and the judge. Else compile, screenshot,
   and **Judge** (a different Flash call) scores Content and Design 1–5.

Neither model talks to the person (FR-10). Visual QA is never skipped when
structure passed. Pass is Content ≥ 4 and Design ≥ 4 on 1–5 bands. After 3
turns the last valid compile is persisted even if the bands are still below
4 (`criticPassed` stays false).

Locally this machine needs LibreOffice (`soffice`). Set `LIBREOFFICE_BIN`
if it is not in the default install path. The Cloud Run image installs
Impress and Carlito (Calibri metrics) so prod is the same loop.

Archetypes live in `services/document-cell/references/` (also `SLIDE_REFERENCE_DIR`).
Planner and judge both see them. They never share a conversation.

## Bounds (code, not a prompt)

| Bound | Cap |
|---|---|
| Turns | 3 (plan + repair + optional compile + screenshot + judge) |
| Pass threshold | Content ≥ 4 and Design ≥ 4 |
| Images | 8 per artifact (generated once per unique prompt) |
| Supports per slide | 4 |
| Wall clock | 240s without images, 420s with |
| Recursion | none |

## Local

```
npm run dev:document
```

Listens on `:8095`. Start it with `npm run dev:document` while the gateway
uses the emulator: Yes then POSTs `/compile` here. If the cell is down, Yes
degrades to the in-process renderer (same loop, still needs LibreOffice).
Production always sets `DOCUMENT_CELL_URL`.
