/**
 * Fetches and grades the "In practice" photography.
 *
 * Source: Pexels. The Pexels License permits free commercial use with no
 * attribution required; credits are recorded in public/images/CREDITS.md anyway.
 * Re-run only if the photo set changes — outputs are committed.
 *
 * One treatment for all three, so the row reads as a set rather than a
 * stock-library grab bag: identical 16:10 crop, saturation pulled back, and a
 * brand-blue soft-light pass that seats them against the porcelain ground.
 */
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const W = 1200, H = 750;

const PHOTOS = [
  { id: "3278757", out: "practice-draft", credit: "lil artsy" },
  { id: "7195318", out: "practice-transcript", credit: "Tima Miroshnichenko" },
  { id: "14299948", out: "practice-reschedule", credit: "Peter Olexa" },
];

const warm = await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 2, g: 105, b: 230, alpha: 0.30 } },
}).png().toBuffer();

const lines = ["# Photo credits", "", "Source: Pexels (Pexels License — free for commercial use, no attribution required).", ""];

for (const p of PHOTOS) {
  const url = `https://images.pexels.com/photos/${p.id}/pexels-photo-${p.id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${p.id}: HTTP ${res.status}`);
  const src = Buffer.from(await res.arrayBuffer());

  const graded = await sharp(src)
    .resize(W, H, { fit: "cover", position: "centre" })
    .modulate({ saturation: 0.78, brightness: 1.04 })
    .composite([{ input: warm, blend: "soft-light" }])
    .toBuffer();

  await sharp(graded).webp({ quality: 76 }).toFile(`public/images/${p.out}.webp`);
  const { size } = await sharp(`public/images/${p.out}.webp`).metadata();
  console.log(`${p.out}.webp  ${(size / 1024).toFixed(0)} KB`);

  lines.push(`- \`${p.out}.webp\` — photo by ${p.credit}, https://www.pexels.com/photo/${p.id}/`);
}

await writeFile("public/images/CREDITS.md", lines.join("\n") + "\n", "utf8");
console.log("wrote public/images/CREDITS.md");
