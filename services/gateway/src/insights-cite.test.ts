import "./test-env.js";
import { equal } from "node:assert/strict";
import { test } from "node:test";

import { citeOrDrop } from "./meetings/insights.js";

test("an uncited context claim is dropped rather than shown", () => {
  const sources = citeOrDrop("context", "A paper we never retrieved", [{ title: "Contract" }], []);
  equal(sources, null);
});

test("an unanswered question needs no citation", () => {
  const sources = citeOrDrop("unanswered", "", [], []);
  equal(sources?.length, 0);
});

test("a named document that was actually retrieved is kept", () => {
  const sources = citeOrDrop("contradiction", "see Contract p2", [{ title: "Contract", page: 2 }], []);
  equal(sources?.[0]?.kind, "document");
});
