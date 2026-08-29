/**
 * Work redesign, as a person uses it.
 *
 * Needs: emulators, gateway (ARTIFACTS_DIR), orchestrator, web on :5173.
 * Localhost bypasses sign-in; ALLOW_ANONYMOUS maps API calls to the seed user.
 */
import { chromium } from "playwright-core";

const BASE = process.env.WEB_URL ?? "http://localhost:5173";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

const main = () => page.locator("#app-main");
const composer = () => main().locator("#composer");

await page.goto(`${BASE}/app/work`, { waitUntil: "networkidle" });

const greeting = await main().locator("h1").first().innerText();
check("new Work greets instead of opening a thread", /good (morning|afternoon|evening)/i.test(greeting), greeting);

check(
  "previous chats list the seeded rows",
  await main().getByRole("link", { name: /Grant application draft/i }).isVisible(),
);

check(
  "a new chat has no artifacts yet",
  await main().getByText(/nothing made yet/i).isVisible(),
);

const chatBox = main().locator("section").first();
const rail = main().locator("aside");
const chatWidth = (await chatBox.boundingBox())?.width ?? 0;
const railWidth = (await rail.boundingBox())?.width ?? 0;
check(
  "chat is the wider column (~70/30)",
  chatWidth > railWidth * 1.5,
  `chat ${Math.round(chatWidth)} rail ${Math.round(railWidth)}`,
);

await composer().fill(
  "Write a markdown briefing I can keep here for the Q4 product launch. Include goals, risks, and next steps.",
);
await main().getByRole("button", { name: "Send" }).click();
await page.waitForURL("**/app/work/**", { timeout: 20000 });
await composer().waitFor({ timeout: 15000 });
const dialog = main().locator('[role="alertdialog"]');
await dialog.waitFor({ timeout: 90000 }).catch(() => {});
const gated = (await dialog.count()) > 0;
check("creating a file stops for confirmation", gated);
if (!gated) {
  console.log("      screen:", (await main().innerText()).slice(0, 400).replace(/\s+/g, " "));
}
if (gated) {
  const text = await dialog.innerText();
  check("the summary names a markdown note or file", /markdown|note|file|session|briefing/i.test(text), text.slice(0, 80));
  const posted = page.waitForResponse(
    (r) => r.url().includes("/decision") && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await main().getByRole("button", { name: /Yes, go ahead/i }).click();
  const decision = await posted;
  const payload = await decision.json().catch(() => ({}));
  console.log("      decision", decision.status(), JSON.stringify(payload).slice(0, 400));
  await dialog.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
}

await page.waitForTimeout(1500);
const artifactCard = main().locator("aside button").filter({ hasText: /brief|launch|Q4|note|untitled/i }).first();
const hasArtifact = (await main().locator("aside button").count()) > 1;
check("an artifact lands in Current Work", hasArtifact || (await artifactCard.count()) > 0);

if (hasArtifact || (await artifactCard.count()) > 0) {
  const open = (await artifactCard.count()) > 0
    ? artifactCard
    : main().locator("aside").getByRole("button").filter({ hasNotText: /create empty/i }).first();
  await open.click();
  const dialogBody = page.getByRole("dialog");
  await dialogBody.waitFor({ timeout: 15000 });
  await dialogBody.getByRole("button", { name: /Edit/i }).waitFor({ timeout: 20000 });
  const body = await dialogBody.innerText();
  check(
    "markdown preview renders headings, not source hashes",
    /goals|risks|next|briefing|launch/i.test(body) && !/^# /m.test(body.split("\n").find((l) => l.startsWith("#")) ?? ""),
    body.slice(0, 200).replace(/\s+/g, " "),
  );
  check("preview is the default (Edit is offered)", await dialogBody.getByRole("button", { name: /Edit/i }).isVisible());
  await page.keyboard.press("Escape");
}

console.log("  page errors:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
if (failures.length) process.exit(1);
