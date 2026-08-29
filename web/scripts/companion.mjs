import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge" });
const fails = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails.push(msg);
};

const widths = [
  { name: "phone", w: 390, h: 844 },
  { name: "tablet", w: 900, h: 1000 },
  { name: "laptop-devtools", w: 1100, h: 800 },
  { name: "desktop", w: 1440, h: 900 },
];

for (const v of widths) {
  const ctx = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  console.log(`\n[${v.name}] ${v.w}x${v.h}`);

  const fab = page.getByRole("button", { name: "Open companion", exact: true });
  const aside = page.locator('aside[aria-label="Companion"]');

  ok(await fab.isVisible(), "FAB is visible");
  ok(!(await aside.isVisible()), "docked column is not visible");

  // The FAB must not sit under the floating tab bar.
  const tab = page.locator("nav").last();
  if (await tab.isVisible()) {
    const f = await fab.boundingBox();
    const t = await tab.boundingBox();
    ok(f && t && f.y + f.height <= t.y + 1, "FAB clears the tab bar");
  }

  await fab.click();
  await page.waitForTimeout(500);

  const dialog = page.locator('[data-slot="sheet-content"]');
  ok(await dialog.isVisible(), "sheet opens on click");

  const box = await dialog.boundingBox();
  if (v.w < 640) {
    ok(box && Math.abs(box.width - v.w) < 2, `sheet is full-bleed (${box?.width}px of ${v.w})`);
  } else {
    ok(box && box.width > 300 && box.width < v.w, `sheet is a panel (${box?.width}px of ${v.w})`);
  }

  const blur = await page
    .locator('[data-slot="sheet-overlay"]')
    .evaluate((el) => getComputedStyle(el).backdropFilter);
  ok(/blur/.test(blur), `backdrop is blurred (${blur})`);

  ok(
    await dialog.getByRole("heading", { name: "Companion" }).isVisible(),
    "conversation is rendered inside the sheet",
  );

  // A message typed in the sheet is the same thread the column would show.
  await dialog.getByLabel("Message the companion").fill("does this thread persist");
  await dialog.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(400);
  ok(
    await dialog.getByText("does this thread persist").isVisible(),
    "sending works inside the sheet",
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok(!(await dialog.isVisible()), "Escape closes the sheet");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  ok(!overflow, "no horizontal overflow");
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);

  await ctx.close();
}

await browser.close();
console.log(`\n${fails.length ? `FAILURES (${fails.length}):\n - ${fails.join("\n - ")}` : "all checks passed"}`);
process.exit(fails.length ? 1 : 0);
