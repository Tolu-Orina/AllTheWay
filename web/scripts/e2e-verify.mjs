import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = "http://localhost:5173";
const GW_LOG = "C:/Users/toluo/AppData/Local/Temp/gw.log";
const email = `grace.hopper.${Date.now()}@example.com`;

const b = await chromium.launch({ channel: "msedge" });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })).newPage();
const check = (n, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);

const codeFromLog = () => {
  const lines = readFileSync(GW_LOG, "utf8").split("\n").filter((l) => l.includes(email));
  const last = lines.at(-1) ?? "";
  return (/(\d{6})\s*$/.exec(last) ?? [])[1] ?? null;
};

await page.goto(`${BASE}/app/signup`, { waitUntil: "networkidle" });
await page.fill("#email", email);
await page.fill("#password", "compiler1");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL("**/app/verify", { timeout: 20000 });
check("signup creates the account and advances to /app/verify", page.url().endsWith("/app/verify"));

// Give the gateway a beat to issue and "send" the code.
await new Promise((r) => setTimeout(r, 1500));
const code = codeFromLog();
check(`gateway issued a 6-digit code (${code ?? "none"})`, /^\d{6}$/.test(code ?? ""));

// A wrong code must be rejected before the right one is accepted.
await page.getByLabel("Digit 1").focus();
await page.evaluate((c) => {
  const dt = new DataTransfer();
  dt.setData("text", c);
  document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}, code === "000000" ? "111111" : "000000");
await page.waitForSelector('[role="alert"]', { timeout: 15000 });
check("wrong code is rejected server-side", (await page.locator('[role="alert"]').innerText()).length > 0);

await page.getByLabel("Digit 1").focus();
await page.evaluate((c) => {
  const dt = new DataTransfer();
  dt.setData("text", c);
  document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
}, code);
await page.waitForURL((url) => /\/app\/?$/.test(url.pathname), { timeout: 20000 });
check("correct code verifies and lands in /app", /\/app\/?$/.test(new URL(page.url()).pathname));

await b.close();
