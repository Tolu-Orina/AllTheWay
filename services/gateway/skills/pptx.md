# PowerPoint skill

Use this when they asked for a PowerPoint, .pptx, or slide deck.

Emit **deck.v1** in `work_files.create_slides` arguments. The compiler owns
coordinates. Do not invent x/y.

```json
{
  "ir": "deck.v1",
  "title": "Q4 launch",
  "audience": "the Board",
  "slides": [
    { "layout": "title", "kicker": "Board briefing", "subtitle": "2 September 2026", "image": { "kind": "generate", "prompt": "wide cinematic photograph of a product launch war-room at dusk, no text" } },
    { "layout": "two-card", "title": "What ships", "cards": [{ "title": "In", "body": "…" }, { "title": "Waits", "body": "…" }] },
    { "layout": "metric-row", "title": "Goals", "metrics": [{ "label": "ARR", "value": "£6.4m", "owner": "Elena", "detail": "112% of plan" }] },
    { "layout": "split-visual", "title": "The product", "image": { "kind": "generate", "prompt": "hero product photography of the device on a dark studio set, no text" }, "bullets": ["…"] },
    { "layout": "chart", "title": "Budget", "chart": { "type": "bar", "categories": ["Ads","Events"], "series": [{ "name": "GBP", "values": [120,80] }] } },
    { "layout": "photo-story", "title": "In the field", "image": { "kind": "generate", "prompt": "customers using the product in a real office, editorial, no text" }, "bullets": ["…"] },
    { "layout": "closing-ask", "title": "Decision", "asks": ["…"] }
  ]
}
```

## Layouts

Pick **one layout per slide**: `title`, `two-card`, `metric-row`, `split-visual`,
`photo-story`, `chart`, `closing-ask`, `quote`, `agenda`, `bullets`.

- Native `chart` when they gave or implied numbers. Not a generated picture of a graph.
- At least **three** `{ "kind": "generate", "prompt": "…" }` slots. Typical: cover,
  split-visual (product), photo-story (people/place). Never on metric-row or chart.
- Prompts describe a specific photograph that belongs on that slide.
- Do not generate images at plan time. After Yes the cell fills `generate` slots,
  screenshots the PPTX in LibreOffice, and runs visual QA until score >= 95 or 6 turns.
- Titles are action titles: a complete-sentence takeaway, not a topic label.
  Reading only the titles must tell the recommendation story.
- Max ~8 slides unless they asked for more. At most six short bullets per slide.
- Specific numbers and named owners. Never lorem. Source every number.

The cell compiles templates (cards, charts, `addImage`). Legacy `{title, bullets}`
still compiles, but do not emit that when the request is a real deck.
