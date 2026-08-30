import { chromium } from "playwright-core";

const LAN = process.env.LAN_HOST;
const b = await chromium.launch({ channel: "msedge" });
const check = (n, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
const fresh = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  return ctx;
};

// 0. old /login bookmark stays inside the product
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto("http://localhost:4173/login", { waitUntil: "networkidle" });
  check("legacy /login redirects to /app/login", p.url().includes("/app/login"));
  await ctx.close();
}

// 1. localhost bypass — every page stays reachable during development
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto("http://localhost:4173/app/watchers", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  check("localhost: /app/watchers reachable unauthenticated", p.url().includes("/app/watchers"));
  await ctx.close();
}

// 2. non-localhost host — guard redirects to /app/login (PWA scope)
if (LAN) {
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto(`http://${LAN}:4173/app/watchers`, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  check(`guard active on ${LAN}: redirected to /app/login`, p.url().includes("/app/login"));
  await ctx.close();
} else {
  console.log("  SKIP  no non-localhost interface available");
}

// 3. signup -> code -> app  (localhost, but the flow itself is host-independent)
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  let code = null;
  p.on("console", (m) => {
    const hit = /verification code for .*?: (\d{6})/.exec(m.text());
    if (hit) code = hit[1];
  });
  await p.goto("http://localhost:4173/app/signup", { waitUntil: "networkidle" });
  await p.fill("#email", "ada.lovelace@example.com");
  await p.fill("#password", "analytic1");
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL("**/app/verify", { timeout: 8000 });
  check("signup advances to /app/verify", p.url().endsWith("/app/verify"));
  await p.waitForTimeout(400);
  check("verification code issued", !!code);

  // paste the whole code, as people actually do from an email
  await p.getByLabel("Digit 1").focus();
  await p.evaluate((c) => {
    const dt = new DataTransfer();
    dt.setData("text", c);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, code);
  await p.waitForURL("**/app", { timeout: 8000 });
  check("pasted code auto-submits and lands in /app", /\/app\/?$/.test(new URL(p.url()).pathname));

  // name derived from the signup email
  const initials = await p.locator('[role="img"]').first().getAttribute("aria-label");
  check(`avatar shows derived name (${initials})`, initials === "Ada Lovelace");
  await ctx.close();
}

// 4. wrong password -> generic error (no account enumeration)
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto("http://localhost:4173/app/login", { waitUntil: "networkidle" });
  await p.fill("#email", "nobody@example.com");
  await p.fill("#password", "wrongpass1");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForSelector('[role="alert"]', { timeout: 8000 });
  const msg = await p.locator('[role="alert"]').innerText();
  check(`generic sign-in error ("${msg}")`, msg.includes("Incorrect email or password"));
  await ctx.close();
}

// 5. forgot password does not reveal whether the account exists
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto("http://localhost:4173/app/forgot-password", { waitUntil: "networkidle" });
  await p.fill("#email", "definitely-not-registered@example.com");
  await p.getByRole("button", { name: "Send code" }).click();
  await p.waitForURL("**/app/reset-password", { timeout: 8000 });
  check("unknown email still advances (no enumeration)", p.url().endsWith("/app/reset-password"));
  await ctx.close();
}

// 6. Google sign-in
{
  const ctx = await fresh();
  const p = await ctx.newPage();
  await p.goto("http://localhost:4173/app/login", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Sign in with Google" }).click();
  await p.waitForURL((url) => /\/app\/?$/.test(url.pathname), { timeout: 8000 });
  check("Google sign-in lands in /app", /\/app\/?$/.test(new URL(p.url()).pathname));
  await ctx.close();
}

await b.close();
