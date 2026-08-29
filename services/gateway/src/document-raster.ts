import { decode as decodeJpeg } from "jpeg-js";
import { type DeckIr } from "./office-ir.js";
import { PixelCanvas, type Rgb } from "./document-png.js";

/**
 * IR compositor. Kept for tests and offline eval. Production visual QA
 * screenshots the compiled PPTX in LibreOffice — this is not a substitute.
 */

const NAVY: Rgb = [2, 36, 120];
const BLUE: Rgb = [2, 105, 230];
const WASH: Rgb = [243, 246, 253];
const WHITE: Rgb = [255, 255, 255];
const MUTED: Rgb = [90, 103, 133];
const INK: Rgb = [11, 21, 51];

export function rasterDeck(
  deck: DeckIr,
  images: Record<number, Buffer> = {},
  width = 1920,
): Buffer[] {
  const W = width;
  const H = Math.round((width * 1080) / 1920);
  const s = W / 1920;
  const x = (n: number) => Math.round(n * s);
  return deck.slides.map((slide, index) => {
    const canvas = new PixelCanvas(W, H, slide.layout === "title" ? NAVY : WHITE);
    const photo = images[index];
    if (slide.layout === "title") {
      canvas.fill(0, 0, x(24), H, BLUE);
      if (photo) blitCover(canvas, photo, x(1040), 0, x(880), H);
      else canvas.fill(x(1040), 0, x(880), H, [8, 48, 140]);
      canvas.fill(0, 0, x(1040), H, NAVY);
      canvas.fill(0, 0, x(24), H, BLUE);
      canvas.fill(x(90), x(620), x(220), x(10), BLUE);
      return canvas.png();
    }
    canvas.fill(0, 0, W, x(14), NAVY);
    canvas.fill(0, H - x(48), W, x(48), WHITE);
    canvas.fill(0, H - x(48), W, x(2), MUTED);
    if (slide.layout === "two-card") {
      canvas.fill(x(80), x(180), x(860), x(740), WASH);
      canvas.fill(x(980), x(180), x(860), x(740), WASH);
      canvas.fill(x(80), x(180), x(16), x(740), BLUE);
      canvas.fill(x(980), x(180), x(16), x(740), BLUE);
    } else if (slide.layout === "metric-row") {
      const n = Math.max(1, Math.min(4, slide.metrics?.length || 1));
      const w = (W - x(160) - (n - 1) * x(28)) / n;
      for (let i = 0; i < n; i++) canvas.fill(x(80) + i * (w + x(28)), x(200), w, x(680), WASH);
    } else if (slide.layout === "split-visual") {
      canvas.fill(x(80), x(180), x(900), x(740), WASH);
      if (photo) blitCover(canvas, photo, x(100), x(200), x(860), x(700));
      canvas.fill(x(1040), x(180), x(800), x(740), WHITE);
      canvas.fill(x(1080), x(240), x(720), x(24), INK);
      canvas.fill(x(1080), x(300), x(720), x(24), INK);
    } else if (slide.layout === "photo-story") {
      canvas.fill(x(80), x(180), x(1760), x(620), WASH);
      if (photo) blitCover(canvas, photo, x(80), x(180), x(1760), x(620));
      canvas.fill(x(80), x(830), x(1760), x(24), INK);
      canvas.fill(x(80), x(870), x(1400), x(20), MUTED);
    } else if (slide.layout === "chart") {
      canvas.fill(x(80), x(180), x(1760), x(740), WASH);
      canvas.fill(x(140), x(280), x(70), x(560), NAVY);
      canvas.fill(x(280), x(380), x(70), x(440), BLUE);
      canvas.fill(x(420), x(340), x(70), x(480), NAVY);
    } else if (slide.layout === "closing-ask") {
      const n = Math.max(1, Math.min(4, slide.asks?.length || slide.bullets?.length || 1));
      for (let i = 0; i < n; i++) {
        canvas.fill(x(80), x(180) + i * x(180), x(1760), x(150), WASH);
        canvas.fill(x(80), x(180) + i * x(180), x(16), x(150), BLUE);
      }
    } else if (slide.layout === "quote") {
      canvas.fill(x(160), x(280), x(1600), x(480), WASH);
    } else {
      canvas.fill(x(100), x(200), x(1600), x(28), INK);
      canvas.fill(x(100), x(260), x(1440), x(22), MUTED);
      canvas.fill(x(100), x(320), x(1360), x(22), MUTED);
    }
    return canvas.png();
  });
}

function blitCover(canvas: PixelCanvas, bytes: Buffer, x: number, y: number, w: number, h: number): void {
  const decoded = decodeStill(bytes);
  if (!decoded) {
    canvas.fill(x, y, w, h, [20, 40, 80]);
    return;
  }
  canvas.blit(x, y, w, h, decoded, 4);
}

/**
 * Bake a left-edge fade into the still. PPTX transparency is ignored by
 * LibreOffice, so the cover cannot be a navy panel beside a photo.
 */
export function bleedTitleStill(photo: Buffer): Buffer {
  if (!(photo.length >= 2 && photo[0] === 0xff && photo[1] === 0xd8)) return photo;
  const W = 1920;
  const H = 1080;
  const canvas = new PixelCanvas(W, H, [11, 21, 51]);
  blitCover(canvas, photo, 0, 0, W, H);
  const fadeUntil = Math.round(W * 0.58);
  for (let x = 0; x < fadeUntil; x++) {
    const a = (1 - x / fadeUntil) * 0.52;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 3;
      canvas.pixels[i] = Math.round((canvas.pixels[i] ?? 0) * (1 - a) + 11 * a);
      canvas.pixels[i + 1] = Math.round((canvas.pixels[i + 1] ?? 0) * (1 - a) + 21 * a);
      canvas.pixels[i + 2] = Math.round((canvas.pixels[i + 2] ?? 0) * (1 - a) + 51 * a);
    }
  }
  return canvas.png();
}

export function bleedSectionStill(photo: Buffer): Buffer {
  if (!(photo.length >= 2 && photo[0] === 0xff && photo[1] === 0xd8)) return photo;
  const W = 1920;
  const H = 1080;
  const canvas = new PixelCanvas(W, H, [11, 21, 51]);
  blitCover(canvas, photo, 0, 0, W, H);
  const start = Math.round(H * 0.42);
  for (let y = start; y < H; y++) {
    const a = ((y - start) / (H - start)) * 0.72;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      canvas.pixels[i] = Math.round((canvas.pixels[i] ?? 0) * (1 - a));
      canvas.pixels[i + 1] = Math.round((canvas.pixels[i + 1] ?? 0) * (1 - a));
      canvas.pixels[i + 2] = Math.round((canvas.pixels[i + 2] ?? 0) * (1 - a));
    }
  }
  return canvas.png();
}

function decodeStill(bytes: Buffer): { width: number; height: number; data: Uint8Array } | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      return decodeJpeg(bytes, { maxResolutionInMP: 16 });
    } catch {
      return null;
    }
  }
  return null;
}
