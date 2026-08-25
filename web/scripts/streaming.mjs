/**
 * Does the plan panel actually fill in?
 *
 * Typechecking cannot answer that, and neither can a single screenshot. This
 * samples the rendered step count while a turn is in flight: if streaming works
 * the count climbs through intermediate values, and if it is secretly a batch
 * the count jumps straight from 0 to 4.
 *
 * Runs with reducedMotion: "reduce" on purpose. A step that animates in but is
 * invisible under reduced motion is the exact bug that hid the landing page's
 * cards, and it passes every other check.
 *
 * Needs: emulators, gateway, web preview, and an orchestrator started with
 * FAKE_STREAM_DELAY_MS set (45 is plenty). Without it the fake provider answers
 * in about two milliseconds and every step lands inside a single sample, which
 * looks exactly like batching.
 */
import { chromium } from "playwright-core";

const BASE = process.env.WEB_URL ?? "http://localhost:4173";
const CLEAR = "Draft a nav wireframe for the desktop dashboard";
const VAGUE = "do something";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
// The companion panel has its own composer and Send button. Everything here
// means the session screen, so scope to it rather than matching both.
const main = () => page.locator("#app-main");
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${BASE}/app/sessions`, { waitUntil: "networkidle" });
await main().locator("a[href*='/app/sessions/']").first().click();
await main().locator("#composer").waitFor();

// Only rows this turn produced. The session already ships with a four-step
// plan, so counting every row would measure the seed data and pass regardless.
const liveRows = main().locator('section[aria-label="Plan"] ul[data-source="turn"] li');
const composer = () => main().locator("#composer");

/** Samples a locator's count until the composer re-enables, i.e. the turn ended. */
async function sampleWhileWorking(locator) {
  const samples = [];
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    samples.push(await locator.count());
    if (await composer().isEnabled()) break;
    await page.waitForTimeout(30);
  }
  samples.push(await locator.count());
  return samples;
}

// --- a clear request streams in -------------------------------------------
await composer().fill(CLEAR);
// Click first, then sample. Sampling before the click meant the loop's exit
// condition was already true and it recorded a single baseline reading.
await main().getByRole("button", { name: "Send" }).click();
const samples = await sampleWhileWorking(liveRows);

const counts = [...new Set(samples)].sort((a, b) => a - b);
console.log(`  live step counts observed: ${counts.join(" -> ")}`);

check("the plan reaches 4 steps", counts.at(-1) === 4, `saw ${counts.at(-1)}`);
// The load-bearing assertion: intermediate counts existed. A batched render
// would jump straight from 0 to 4 with nothing in between.
const intermediate = counts.filter((c) => c > 0 && c < 4);
check(
  "steps appear one at a time",
  intermediate.length >= 2,
  intermediate.length
    ? `intermediate: ${intermediate.join(",")}`
    : "no intermediate counts — is the orchestrator running with FAKE_STREAM_DELAY_MS? " +
      "the fake answers in ~2ms, which is faster than this loop can sample",
);

const planText = await main().locator('section[aria-label="Plan"]').innerText();
check("steps are visible under reduced motion", planText.includes("Review together"));
check("progress was narrated", (await page.content()).includes("Why it did this"));

// --- an ambiguous request is stopped at the gate ---------------------------
await main().locator("#composer:not([disabled])").waitFor();
await main().locator("#composer").fill(VAGUE);
await main().getByRole("button", { name: "Send" }).click();
await page.waitForSelector("text=what should this cover", { timeout: 9000 });

const afterVague = await liveRows.count();
check("the gate asks before acting", (await page.content()).includes("what should this cover"));
// Nothing planned from an ambiguous request — not "planned then hidden".
check("no plan step is rendered for a vague request", afterVague === 0, `${afterVague} rows`);
check(
  "the offered options are clickable",
  await main().getByRole("button", { name: "Just a rough draft" }).isVisible(),
);

console.log("  page errors:", errs.length ? errs : "none");
if (errs.length) failures.push("page errors");

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join("; ")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
