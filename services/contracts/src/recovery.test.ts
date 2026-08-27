import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  QUALITY_LABELS,
  qualityOf,
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


// ------------------------------------------------------- connection quality

test("a clean connection reads as good", () => {
  strictEqual(qualityOf({ packetLoss: 0, jitter: 20, reconnects: 0 }), "good");
});

test("a single reconnect is already degraded", () => {
  // Something was missed. Reporting that as "good" is the silent degradation
  // this whole phase exists to prevent.
  strictEqual(qualityOf({ packetLoss: 0, jitter: 10, reconnects: 1 }), "degraded");
});

test("loss that starts eating words reads as poor", () => {
  strictEqual(qualityOf({ packetLoss: 0.08, jitter: 10, reconnects: 0 }), "poor");
});

test("inaudible loss is not alarming", () => {
  // 1% loss is imperceptible in speech. Warning about it would train people to
  // ignore the warning that matters.
  strictEqual(qualityOf({ packetLoss: 0.01, jitter: 20, reconnects: 0 }), "good");
});

test("any one bad signal is enough", () => {
  // These are not averaged. Jitter alone can scramble a sentence while loss
  // stays at zero, and a mean would hide it.
  strictEqual(qualityOf({ packetLoss: 0, jitter: 200, reconnects: 0 }), "poor");
  strictEqual(qualityOf({ packetLoss: 0, jitter: 0, reconnects: 3 }), "poor");
});

test("quality never improves as any signal worsens", () => {
  /**
   * A monotonicity check, because the thresholds are ORed and it would be easy
   * to reorder them into a state where more loss reported better quality.
   */
  const rank = { good: 0, degraded: 1, poor: 2 } as const;
  let previous = 0;
  for (const loss of [0, 0.01, 0.02, 0.05, 0.08, 0.2]) {
    const current = rank[qualityOf({ packetLoss: loss, jitter: 0, reconnects: 0 })];
    ok(current >= previous, `loss ${loss} reported better quality than the step before`);
    previous = current;
  }
});

test("every quality is named for what it costs the reader", () => {
  // "Moderate" does not tell someone whether to take their own notes.
  for (const [quality, label] of Object.entries(QUALITY_LABELS)) {
    ok(label.length > 5, quality);
    ok(!/^(fair|moderate|ok|average)$/i.test(label), `${quality} is named for a metric`);
  }
  ok(QUALITY_LABELS.poor.toLowerCase().includes("gap"));
});
