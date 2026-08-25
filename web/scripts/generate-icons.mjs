/**
 * Derives the icons the PWA needs from the supplied logo.
 *
 * Source of truth is public/android-chrome-512x512.png (added by the brand owner).
 * Everything below is generated — do not hand-edit the outputs.
 *   - icon-maskable-512.png : Android adaptive icon. The mark is inset into the
 *     80% safe zone over a solid ground, so launcher masks never clip it.
 *   - logo-mark-64.webp     : small, sharp mark for the site header/footer.
 *
 * Run: node scripts/generate-icons.mjs
 */
import sharp from "sharp";

const SRC = "public/android-chrome-512x512.png";

// Maskable: 512 canvas, mark at 60% (307px) centred — comfortably inside the safe zone.
const inner = await sharp(SRC).resize(307, 307, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ffffff" } })
  .composite([{ input: inner, top: 102, left: 102 }])
  .png()
  .toFile("public/icon-maskable-512.png");
console.log("wrote public/icon-maskable-512.png (512x512, maskable, 60% safe-zone inset)");

await sharp(SRC).resize(64, 64).webp({ quality: 92 }).toFile("public/logo-mark-64.webp");
console.log("wrote public/logo-mark-64.webp (header/footer mark)");
