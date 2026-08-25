import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge" });

// --- horizontal overflow at mobile width ---
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(400);

const overflow = await page.evaluate(() => {
  const docW = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > docW + 1 || r.left < -1)) {
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() || "").slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
      });
    }
  });
  return {
    docW,
    scrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    offenders: out.slice(0, 12),
  };
});
console.log("=== mobile overflow ===");
console.log(JSON.stringify(overflow, null, 2));
await browser.close();
