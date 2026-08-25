import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const info = await page.evaluate(() => ({
  h1Count: document.querySelectorAll("h1").length,
  headlineCount: document.body.innerText.split("Finally, an agent that goes").length - 1,
  rootChildren: document.getElementById("root")?.children.length,
  hasSW: "serviceWorker" in navigator,
  swRegistered: !!navigator.serviceWorker?.controller || undefined,
}));
console.log(JSON.stringify(info, null, 2));
console.log("errors:", errs.length ? errs : "none");
await browser.close();
