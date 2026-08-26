import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  FailureKindSchema,
  ROUTES,
  RouteSchema,
  failureKindFor,
  routesFor,
  type FailureKind,
} from "./recovery.js";

/**
 * "A failure with no route is where trust is lost." These tests are what stops
 * that decaying as new failures appear.
 *
 * The strongest guarantee is not here: `ROUTES` is typed
 * `Record<FailureKind, Route[]>`, so a kind added without routes fails to
 * compile. These check what the type cannot.
 */

const ALL = FailureKindSchema.options as FailureKind[];

test("every failure kind has routes", () => {
  for (const kind of ALL) {
    ok(routesFor(kind).length > 0, `${kind} has no route forward`);
  }
});

test("every failure kind has more than one route", () => {
  // A single route is a dead end wearing a button. The second is usually "do it
  // another way", which is the move people actually want.
  for (const kind of ALL) {
    ok(routesFor(kind).length >= 2, `${kind} offers only one way out`);
  }
});

test("every route is well formed", () => {
  for (const kind of ALL) {
    for (const r of routesFor(kind)) {
      const parsed = RouteSchema.safeParse(r);
      ok(parsed.success, `${kind}/${r.id} is malformed`);
    }
  }
});

test("route ids are unique within a failure", () => {
  // Duplicates would render two identical buttons and make the recorded
  // routeTaken ambiguous — which is the field the whole feature exists to learn
  // from.
  for (const kind of ALL) {
    const ids = routesFor(kind).map((r) => r.id);
    strictEqual(new Set(ids).size, ids.length, `${kind} has duplicate route ids`);
  }
});

test("navigate routes name a destination and others do not", () => {
  for (const kind of ALL) {
    for (const r of routesFor(kind)) {
      if (r.kind === "navigate") {
        ok(r.to && r.to.startsWith("/"), `${kind}/${r.id} navigates nowhere`);
      } else {
        strictEqual(r.to, undefined, `${kind}/${r.id} carries a destination it will not use`);
      }
    }
  }
});

test("no failure offers only an explanation", () => {
  // An explanation resolves nothing. Alone, it is an apology with a button.
  for (const kind of ALL) {
    const actionable = routesFor(kind).filter((r) => r.kind !== "explain");
    ok(actionable.length > 0, `${kind} only explains itself`);
  }
});

test("a blocked document is never offered a retry", () => {
  /**
   * The specific case worth pinning.
   *
   * Screening refuses the same content the same way every time. Offering "try
   * again" would teach the user the block is arbitrary and that persistence
   * beats it — the opposite of what a screener is for.
   */
  ok(!routesFor("screening_blocked").some((r) => r.kind === "retry"));
});

test("routes are written in words a person would use", () => {
  // "upstream_error" is not a route. Labels leaking wire vocabulary are how a
  // failure surface ends up describing our architecture instead of their
  // options.
  for (const kind of ALL) {
    for (const r of routesFor(kind)) {
      ok(r.label.length > 3, `${kind}/${r.id} has no label`);
      ok(!/_/.test(r.label), `${kind}/${r.id} leaks a wire identifier: ${r.label}`);
      ok(
        r.label[0] === r.label[0]?.toUpperCase(),
        `${kind}/${r.id} label does not start as a sentence`,
      );
    }
  }
});

test("known wire codes map to a failure kind", () => {
  // These are the codes the services actually emit today. A code that stops
  // mapping is a failure that silently loses its routes.
  for (const code of [
    "needs_consent",
    "no_grant",
    "out_of_scope",
    "unknown_tool",
    "plan_limit",
    "quota_exhausted",
    "not_confirmed",
    "above_ceiling",
    "cost_not_acknowledged",
    "rate_limited",
    "blocked",
    "too_large",
    "not_configured",
    "upstream_error",
    "internal",
  ]) {
    const kind = failureKindFor(code);
    ok(kind !== null, `${code} maps to no failure kind`);
    ok(routesFor(kind!).length > 0);
  }
});

test("a client bug is not dressed up as a user failure", () => {
  // A malformed request is our mistake. Offering the user a recovery route for
  // it asks them to work around a bug they cannot see.
  strictEqual(failureKindFor("invalid_request"), null);
  strictEqual(failureKindFor("unauthenticated"), null);
});

test("every kind in the schema is present in the table", () => {
  // Belt and braces over the Record type: this also catches a kind removed
  // from the table while the schema still names it.
  strictEqual(Object.keys(ROUTES).length, ALL.length);
  for (const kind of ALL) ok(kind in ROUTES, `${kind} missing from ROUTES`);
});
