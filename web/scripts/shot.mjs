import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });

const shots = [
  { name: "desktop-light", width: 1440, height: 1000, dark: false, full: true },
  { name: "desktop-dark", width: 1440, height: 1000, dark: true, full: true },
  { name: "mobile-light", width: 390, height: 844, dark: false, full: true },
  { name: "mobile-dark", width: 390, height: 844, dark: true, full: true },
];

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 1,
    colorScheme: s.dark ? "dark" : "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  if (s.dark) await page.addInitScript(() => document.documentElement.classList.add("dark"));
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/${s.name}.png`, fullPage: s.full });
  console.log("captured", s.name);
  await ctx.close();
}

await browser.close();
