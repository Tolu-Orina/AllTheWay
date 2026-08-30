# PowerPoint skill

Use this when they asked for a PowerPoint, .pptx, or slide deck.

Emit **deck.v1** in `work_files.create_slides` arguments. This is a **story
brief**. Do not invent x/y. After Yes the document-cell planner maps Office
layout, background, and coordinates; the worker generates stills and
compiles; an independent judge scores the LibreOffice screenshots.

```json
{
  "ir": "deck.v1",
  "title": "Q4 launch",
  "audience": "the Board",
  "slides": [
    { "layout": "title-slide", "kicker": "Board briefing", "subtitle": "2 September 2026", "image": { "kind": "generate", "prompt": "wide cinematic photograph of a product launch war-room at dusk, no text" } },
    { "layout": "title-and-two-columns", "title": "What ships", "cards": [{ "title": "In", "body": "…" }, { "title": "Waits", "body": "…" }] },
    { "layout": "big-number", "title": "Goals", "metrics": [{ "label": "ARR", "value": "£6.4m", "owner": "Elena", "detail": "112% of plan" }] },
    { "layout": "section-title-and-description", "title": "The product", "image": { "kind": "generate", "prompt": "hero product photography of the device on a dark studio set, no text" }, "bullets": ["…"] },
    { "layout": "title-and-body", "title": "Budget", "chart": { "type": "bar", "categories": ["Ads","Events"], "series": [{ "name": "GBP", "values": [120,80] }] } },
    { "layout": "section-header", "title": "In the field", "image": { "kind": "generate", "prompt": "customers using the product in a real office, editorial, no text" }, "bullets": ["…"] },
    { "layout": "title-and-body", "title": "Decision", "asks": ["…"] }
  ]
}
```

## Layouts

Pick **one layout per slide**: `title-slide`, `section-header`,
`title-and-body`, `title-and-two-columns`, `title-only`, `one-column-text`,
`main-point`, `section-title-and-description`, `caption`, `big-number`,
`blank`. Legacy names (`title`, `two-card`, `metric-row`, …) still compile.

- Native `chart` when they gave or implied numbers. Not a generated picture of a graph.
- Name a `{ "kind": "generate", "prompt": "…" }` slot only when the photograph
  is the exhibit (cover, section, split). Never on `big-number`.
- Prompts describe a specific photograph that belongs on that slide.
- Do not generate images at plan time. After Yes the cell planner places
  boxes, the worker fills stills, screenshots the PPTX in LibreOffice, and
  an independent judge scores until >= 95 or 6 turns.
- Titles are action titles: a complete-sentence takeaway, not a topic label.
  Reading only the titles must tell the recommendation story.
- Max ~8 slides unless they asked for more. At most four supports per slide.
- Specific numbers and named owners. Never lorem. Source every number.

Legacy `{title, bullets}` still compiles, but do not emit that when the
request is a real deck.
