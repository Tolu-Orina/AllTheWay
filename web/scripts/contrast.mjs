import { chromium } from "playwright-core";

const check = async (page, label) => {
  const results = await page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const over = (fg, bg) =>
      fg.a >= 1
        ? fg
        : {
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
            a: 1,
          };
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.85) return c;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const out = [];
    document.querySelectorAll("p,h1,h2,h3,span,a,li,dt,dd,button").forEach((el) => {
      const txt = el.textContent?.trim() ?? "";
      if (!txt || el.children.length > 0) return;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") return;
      const fg = parse(cs.color);
      if (!fg) return;
      const bg = effBg(el);
      const cr = ratio(over(fg, bg), bg);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const floor = large ? 3 : 4.5;
      if (cr < floor) {
        out.push({
          text: txt.slice(0, 44),
          size: Math.round(size),
          weight,
          ratio: +cr.toFixed(2),
          floor,
        });
      }
    });
    return out;
  });

  console.log(`\n=== ${label} — ${results.length} failing pairs ===`);
  const seen = new Set();
  for (const r of results) {
    const k = `${r.text}|${r.ratio}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${r.ratio} (need ${r.floor}) ${r.size}px/${r.weight} — "${r.text}"`);
  }
};

const browser = await chromium.launch({ channel: "msedge" });
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: scheme,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:4173${process.env.AUDIT_PATH || "/"}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await check(page, scheme);
  await ctx.close();
}
await browser.close();
