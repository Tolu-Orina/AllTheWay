import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { citedLookup, webChunksFromCandidate } from "./look-up.js";

test("grounding chunks without http are dropped", () => {
  const chunks = webChunksFromCandidate({
    groundingMetadata: {
      groundingChunks: [
        { web: { title: "Met Office", uri: "https://www.metoffice.gov.uk/x" } },
        { web: { title: "fake", uri: "not-a-url" } },
        { web: { title: "Met Office", uri: "https://www.metoffice.gov.uk/x" } },
      ],
    },
  });
  assert.deepEqual(chunks, [
    { title: "Met Office", uri: "https://www.metoffice.gov.uk/x" },
  ]);
});

test("no chunks means the lookup did not happen", () => {
  const result = citedLookup("It will rain.", []);
  assert.equal("cannot" in result, true);
  if ("cannot" in result) {
    assert.match(result.cannot, /could not look that up/);
  }
});

test("a cited lookup keeps the URLs that came back", () => {
  const result = citedLookup("Rain later.", [
    { title: "Met Office", uri: "https://www.metoffice.gov.uk/x" },
  ]);
  assert.equal("cannot" in result, false);
  if ("sources" in result) {
    assert.equal(result.sources[0]?.uri, "https://www.metoffice.gov.uk/x");
    assert.equal(result.answer, "Rain later.");
  }
});
