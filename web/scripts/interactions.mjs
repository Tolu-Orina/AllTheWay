import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "msedge" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const check = (name, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);

// --- watcher pause/resume ---
await page.goto("http://localhost:4173/app/watchers", { waitUntil: "networkidle" });
await page.waitForSelector("text=Client inquiries");
const firstCard = page.locator("li", { hasText: "Client inquiries" }).first();
check("watcher starts Running", (await firstCard.innerText()).includes("Running"));
await page.getByRole("button", { name: "Pause Client inquiries" }).click();
await page.waitForTimeout(200);
check("pause -> Paused", (await firstCard.innerText()).includes("Paused"));
await page.getByRole("button", { name: "Resume Client inquiries" }).click();
await page.waitForTimeout(200);
check("resume -> Running", (await firstCard.innerText()).includes("Running"));

// --- profile revert ---
await page.goto("http://localhost:4173/app/you", { waitUntil: "networkidle" });
await page.waitForSelector("text=Navigation");
const before = await page.locator("main li").count();
await page.getByRole("button", { name: "Revert" }).first().click();
await page.waitForTimeout(250);
const after = await page.locator("main li").count();
check(`revert removes a card (${before} -> ${after})`, after === before - 1);
check("revert shows specific confirmation", (await page.locator('[role="status"]').innerText()).includes("reverted"));

// --- companion panel ---
await page.goto("http://localhost:4173/app", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Yes, default to minimal" }).click();
await page.waitForTimeout(300);
const panel = page.locator('aside[aria-label="Companion"]');
check("chip sends a message", (await panel.innerText()).includes("Yes, default to minimal"));
await page.getByRole("button", { name: "Collapse companion panel" }).click();
await page.waitForTimeout(200);
check("panel collapses", (await panel.count()) === 0);
await page.getByRole("button", { name: "Open companion panel" }).click();
await page.waitForTimeout(200);
check("panel reopens", (await page.locator('aside[aria-label="Companion"]').count()) === 1);

// --- error retry ---
await page.goto("http://localhost:4173/app/work?fail=sessions", { waitUntil: "networkidle" });
await page.waitForSelector('[role="alert"]');
check("error state renders", await page.locator('[role="alert"]').isVisible());
check("retry button present", await page.getByRole("button", { name: "Try again" }).isVisible());

console.log("errors:", errs.length ? errs : "none");
await b.close();
