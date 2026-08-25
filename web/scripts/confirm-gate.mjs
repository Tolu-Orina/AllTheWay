/**
 * FR-V2 in a browser: nothing side-effecting runs without an explicit yes.
 *
 * The unit tests prove the gate decides correctly. This proves a person can
 * actually see and answer it — a confirmation that renders off-screen, or has
 * no visible "no", is a gate that does not exist.
 *
 * Runs with reducedMotion: "reduce" for the same reason every other harness
 * here does: a control that animates in but never appears is the bug class that
 * hid the landing page's cards.
 *
 * Needs: emulators, orchestrator, gateway, web preview.
 */
import { chromium } from "playwright-core";

const BASE = process.env.WEB_URL ?? "http://localhost:4173";
const SENDS = "Email the Northwind proposal to Ana today";
const HARMLESS = "Draft a nav wireframe for the desktop dashboard";

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
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

const main = () => page.locator("#app-main");
const composer = () => main().locator("#composer");
const dialog = () => main().locator('[role="alertdialog"]');

async function ask(text) {
  await composer().fill(text);
  await main().getByRole("button", { name: "Send" }).click();
  // The turn is over when the composer re-enables.
  await composer().locator(":scope:not([disabled])").waitFor({ timeout: 20000 });
}

await page.goto(`${BASE}/app/sessions`, { waitUntil: "networkidle" });
await main().locator("a[href*='/app/sessions/']").first().click();
await composer().waitFor();

// --- a harmless plan must not be gated ------------------------------------
await ask(HARMLESS);
check("a plan that changes nothing is not gated", (await dialog().count()) === 0);

// --- a side-effecting plan stops and asks ---------------------------------
await ask(SENDS);
await dialog().waitFor({ timeout: 20000 });
check("a plan that sends stops for confirmation", await dialog().isVisible());

const text = await dialog().innerText();
console.log(`      says: ${text.split("\n")[0].slice(0, 96)}`);
check("the summary says what will happen", /send|account/i.test(text));
check(
  "the reason is given, not just the ask",
  /irreversible|review/i.test(text),
  text.slice(0, 60),
);
check("there is a way to refuse", await main().getByRole("button", { name: /No, stop/i }).isVisible());

// The consequence is visible on the step itself, before anyone is asked.
const planText = await main().locator('section[aria-label="Plan"]').innerText();
check("the sending step is badged in the plan", planText.includes("sends"), planText.slice(0, 70));

// --- declining is recorded and says so ------------------------------------
const before = await (await page.request.get(`${BASE}/api/ledger`)).json();

// Wait for the write itself, not for the message about it. The button resolves
// immediately by design, so asserting on the ledger straight after the click
// races the request that is still in flight.
const posted = page.waitForResponse(
  (r) => r.url().includes("/decision") && r.request().method() === "POST",
  { timeout: 10000 },
);
await main().getByRole("button", { name: /No, stop/i }).click();
const response = await posted;
check("the decision is posted", response.status() === 201, String(response.status()));

const status = main().locator('[role="status"]').first();
await status.waitFor({ timeout: 8000 });
await page.waitForFunction(
  () => !/Saving your answer/.test(document.querySelector('[role="status"]')?.textContent ?? ""),
  { timeout: 8000 },
);
const settled = await status.innerText();
check("declining says nothing was done", /nothing was done/i.test(settled), settled);
check("it does not claim 'recorded' before it is", /recorded/i.test(settled), settled);

const after = await (await page.request.get(`${BASE}/api/ledger`)).json();
check(
  "the decision reaches the Feedback Ledger",
  after.length === before.length + 1,
  `${before.length} -> ${after.length}`,
);
check("it is recorded as declined", after[0]?.kind === "declined", String(after[0]?.kind));

console.log("  page errors:", errs.length ? errs : "none");
if (errs.length) failures.push("page errors");

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join("; ")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
