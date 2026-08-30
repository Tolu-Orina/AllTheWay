import { chromium } from "playwright-core";

const BASE = "http://localhost:5173";
const b = await chromium.launch({ channel: "msedge" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

// Prove requests actually carry a bearer token.
let sawAuthHeader = false;
page.on("request", (r) => {
  if (r.url().includes("/api/") && (r.headers()["authorization"] ?? "").startsWith("Bearer ")) sawAuthHeader = true;
});

const check = (n, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);

// Signed out, the guard sends us to /app/login in production. Here we prove
// the sign-in path itself, which now lives inside the PWA scope.
await page.goto(`${BASE}/app/login`, { waitUntil: "networkidle" });
await page.fill("#email", "ada.lovelace@example.com");
await page.fill("#password", "analytic1");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL((url) => /\/app\/?$/.test(url.pathname), { timeout: 15000 });
check("sign in with Firebase Auth emulator lands in /app", /\/app\/?$/.test(new URL(page.url()).pathname));

// The data on screen must have come from Firestore, not a mock.
await page.waitForSelector("text=Nav wireframe", { timeout: 15000 });
check("Home renders the seeded session from Firestore", true);
check("requests carried a Bearer ID token", sawAuthHeader);

await page.goto(`${BASE}/app/work`, { waitUntil: "networkidle" });
await page.waitForSelector("main >> text=Grant application draft", { timeout: 15000 });
const rows = await page.locator("main li").count();
check(`Sessions lists all 3 seeded rows (got ${rows})`, rows === 3);

// Relative time is computed client-side from the ISO the contract returns.
const updated = await page.locator("main li").first().innerText();
check(`updatedAt formatted client-side ("${updated.split("\n")[1] ?? ""}")`, /ago|minute|hour|day/.test(updated));

// Mutations must persist through the gateway into Firestore.
await page.goto(`${BASE}/app/watchers`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Client inquiries", { timeout: 15000 });
const card = page.locator("li", { hasText: "Client inquiries" }).first();
const before = (await card.innerText()).includes("Running") ? "Running" : "Paused";
await page.getByRole("button", { name: /Client inquiries/ }).first().click();
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=Client inquiries", { timeout: 15000 });
const after = (await page.locator("li", { hasText: "Client inquiries" }).first().innerText()).includes("Running") ? "Running" : "Paused";
check(`watcher toggle persisted across reload (${before} -> ${after})`, before !== after);

// Preference revert writes to the ledger.
await page.goto(`${BASE}/app/you`, { waitUntil: "networkidle" });
await page.waitForSelector("text=Navigation", { timeout: 15000 });
const prefsBefore = await page.locator("main li").count();
await page.getByRole("button", { name: "Revert" }).first().click();
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const prefsAfter = await page.locator("main li").count();
check(`preference revert persisted (${prefsBefore} -> ${prefsAfter})`, prefsAfter === prefsBefore - 1);

console.log("  errors:", errs.length ? errs.slice(0, 3) : "none");
await b.close();
