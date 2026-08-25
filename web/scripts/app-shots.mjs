import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
mkdirSync("screenshots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const issues = [];

const shots = [
  { name: "app-desktop-home", url: "/app", w: 1440, h: 900 },
  { name: "app-desktop-session", url: "/app/sessions/nav", w: 1440, h: 900 },
  { name: "app-desktop-error", url: "/app/sessions?fail=sessions", w: 1440, h: 900 },
  { name: "app-desktop-dark", url: "/app", w: 1440, h: 900, dark: true },
  { name: "app-mobile-home", url: "/app", w: 390, h: 844 },
  { name: "app-mobile-profile", url: "/app/profile", w: 390, h: 844 },
];

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    colorScheme: s.dark ? "dark" : "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => issues.push(`${s.name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") issues.push(`${s.name} console: ${m.text()}`); });
  await page.goto(`http://localhost:4173${s.url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1))
    issues.push(`${s.name}: HORIZONTAL OVERFLOW`);
  await page.screenshot({ path: `screenshots/${s.name}.png` });
  console.log("captured", s.name);
  await ctx.close();
}
await browser.close();
console.log("issues:", issues.length ? issues : "none");
