import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { appliesHat, parseHat } from "./hat.js";

test("an unlabelled fact applies under every hat", () => {
  assert.equal(appliesHat(null, null), true);
  assert.equal(appliesHat(undefined, "home"), true);
  assert.equal(appliesHat(null, "work"), true);
});

test("All includes labelled facts rather than hiding them", () => {
  assert.equal(appliesHat("home", null), true);
  assert.equal(appliesHat("work", null), true);
});

test("a home filter excludes a work fact", () => {
  assert.equal(appliesHat("work", "home"), false);
  assert.equal(appliesHat("home", "home"), true);
});

test("all and empty parse as no filter, not as a guessed hat", () => {
  assert.equal(parseHat("all"), null);
  assert.equal(parseHat(""), null);
  assert.equal(parseHat("school"), null);
  assert.equal(parseHat("home"), "home");
});
