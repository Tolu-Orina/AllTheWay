import { strictEqual } from "node:assert/strict";
import { test } from "node:test";

import { isClean } from "./screening.js";

test("no screener configured means blocked, not allowed", async () => {
  // The direction that matters. An absent control is the strictest case, never
  // the most permissive — a missing ORCHESTRATOR_URL must not become "nothing
  // to screen, carry on".
  const saved = process.env.ORCHESTRATOR_URL;
  delete process.env.ORCHESTRATOR_URL;
  try {
    strictEqual(await isClean("anything at all"), false);
  } finally {
    if (saved !== undefined) process.env.ORCHESTRATOR_URL = saved;
  }
});

test("an unreachable screener means blocked", async () => {
  // A second opinion that cannot be obtained is not a second opinion that said
  // yes. The cost is a meeting marked blocked during an outage; the
  // alternative is an injected transcript reaching a planner because a health
  // check was flaky.
  const saved = process.env.ORCHESTRATOR_URL;
  // Reserved TEST-NET-1 address: routable nowhere, so this fails rather than
  // reaching something real.
  process.env.ORCHESTRATOR_URL = "https://192.0.2.1";
  try {
    strictEqual(await isClean("anything at all"), false);
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_URL;
    else process.env.ORCHESTRATOR_URL = saved;
  }
});
