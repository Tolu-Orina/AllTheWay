import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMBEDDING_DIMENSIONS } from "./document-design.js";
import { catalogObjectPath, parseGsUri } from "./document-design-gcs.js";
import { embedContentBody, partsForSlide } from "./document-multimodal-embed.js";

test("catalog objects live under catalog/{deck}/slide-NN.png", () => {
  assert.equal(catalogObjectPath("case-study", "case-study/slide-01.png"), "catalog/case-study/slide-01.png");
  assert.deepEqual(parseGsUri("gs://alltheway-rinegan-slide-designs-prod/catalog/case-study/slide-01.png"), {
    bucket: "alltheway-rinegan-slide-designs-prod",
    object: "catalog/case-study/slide-01.png",
  });
});

test("a document embedding fuses description text with the screenshot", () => {
  const parts = partsForSlide({
    text: "Navy title slide, title at (0.65,1.94)",
    gcsUri: "gs://bucket/catalog/case-study/slide-01.png",
  });
  const first = parts[0];
  assert.ok(first && "text" in first);
  assert.equal(first.text, "Navy title slide, title at (0.65,1.94)");
  assert.deepEqual(parts[1], {
    fileData: { fileUri: "gs://bucket/catalog/case-study/slide-01.png", mimeType: "image/png" },
  });
  const body = embedContentBody({ parts, task: "RETRIEVAL_DOCUMENT" });
  assert.equal(body.taskType, "RETRIEVAL_DOCUMENT");
  assert.equal(body.outputDimensionality, EMBEDDING_DIMENSIONS);
});

test("a query embedding is text-only in the same space", () => {
  const body = embedContentBody({ parts: [{ text: "board case study" }], task: "RETRIEVAL_QUERY" });
  assert.equal(body.taskType, "RETRIEVAL_QUERY");
});
