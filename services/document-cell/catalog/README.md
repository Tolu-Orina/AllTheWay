# Slide design catalog

Multimodal Graph RAG for how a great PowerPoint is made.

```
screenshot PNG  →  GCS  gs://…-slide-designs-prod/catalog/{deck}/slide-NN.png
screenshot
  + coordinates  →  gemini-embedding-2  →  1536-d vector
  + description
vector + graph   →  Firestore  slideDesigns/{deck}:slide-NN
```

Each JSON file is one deck (local copy; PNG bytes stay out of git):

```json
{
  "overall_deck_description": "how this theme holds together as a sequence",
  "slides": {
    "slide-01": {
      "prev": null,
      "next": "slide-02",
      "image": "case-study/slide-01.png",
      "gcsUri": "gs://…/catalog/case-study/slide-01.png",
      "coordinates": [],
      "description": {}
    }
  }
}
```

The planner retrieves with a text query in the same embedding space, expands
to the whole deck (`prev`/`next`), and attaches previous / hit / next
screenshots plus OOXML coordinates.

Ingest all samples into prod:

```
cd services/gateway
npx tsx scripts/ingest-deck-graph.ts --prod
```

`slideDesigns` is a product catalog, not `users/{uid}/documentChunks`. Never a
collection group. Embeddings are `gemini-embedding-2` at 1536 (Firestore's
working cap; the model default is 3072).
