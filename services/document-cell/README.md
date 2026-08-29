# Document cell

A bounded leaf, the same shape as the research cell: one call after Yes,
workers invisible, bounds in code, degrade instead of looping.

It is **not** a second orchestrator. The turn graph still plans. The person
still confirms. This service compiles `deck.v1` / `report.v1`, fills planned
image slots (metered, max 8), screenshots the compiled PPTX in LibreOffice,
and lets a vision critic score the real slides against a 95 bar and the
same eight archetype screenshots locally and in production. Visual QA is
never skipped. If the score is below 95, the IR is patched and the deck is
compiled again, up to 6 turns. After 6 turns the last valid compile is
persisted even if the score is still below 95 (`criticPassed` stays false).

Locally this machine needs LibreOffice (`soffice`). Set `LIBREOFFICE_BIN`
if it is not in the default install path. The Cloud Run image installs
Impress and Carlito (Calibri metrics) so prod is the same loop.

Archetypes live in `services/document-cell/references/` (also `SLIDE_REFERENCE_DIR`).

## Bounds (code, not a prompt)

| Bound | Cap |
|---|---|
| Visual QA turns | 6 (compile + screenshot + score each turn) |
| Pass threshold | score >= 95 |
| Images | 8 per artifact |
| Supports per slide | 4 |
| Wall clock | 240s without images, 360s with |
| Recursion | none |

## Local

```
npm run dev:document
```

Listens on `:8095`. Start it with `npm run dev:document` while the gateway
uses the emulator: Yes then POSTs `/compile` here. If the cell is down, Yes
degrades to the in-process renderer (same loop, still needs LibreOffice).
Production always sets `DOCUMENT_CELL_URL`.
