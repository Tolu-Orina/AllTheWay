import { decode as decodeJpeg } from "jpeg-js";
import { type DeckIr } from "./office-ir.js";
import { realizeDeck } from "./office-layouts.js";
import { PixelCanvas, type Rgb } from "./document-png.js";

/**
 * IR compositor. Kept for tests and offline eval. Production visual QA
 * screenshots the compiled PPTX in LibreOffice — this is not a substitute.
 */

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [17, 17, 17];
const MUTED: Rgb = [90, 90, 90];

export function rasterDeck(
  deck: DeckIr,
  images: Record<string, Buffer> = {},
  width = 1920,
): Buffer[] {
  const planned = realizeDeck(deck);
  const W = width;
  const H = Math.round((width * 1080) / 1920);
  const inch = W / 13.333;
  const px = (n: number) => Math.round(n * inch);
  return planned.slides.map((slide) => {
    const fill = hexRgb(slide.background?.fill) ?? WHITE;
    const canvas = new PixelCanvas(W, H, fill);
    for (const picture of slide.pictures ?? []) {
      const photo = images[picture.id];
      if (photo) blitCover(canvas, photo, px(picture.x), px(picture.y), px(picture.w), px(picture.h));
      else canvas.fill(px(picture.x), px(picture.y), px(picture.w), px(picture.h), MUTED);
    }
    for (const box of slide.boxes) {
      canvas.fill(px(box.x), px(box.y), px(box.w), Math.max(2, px(0.04)), box.role === "title" ? INK : MUTED);
    }
    return canvas.png();
  });
}

export function bleedTitleStill(photo: Buffer): Buffer {
  return photo;
}

export function bleedSectionStill(photo: Buffer): Buffer {
  return photo;
}

function hexRgb(value: string | undefined): Rgb | null {
  if (!value || !/^[0-9A-Fa-f]{6}$/.test(value)) return null;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function blitCover(canvas: PixelCanvas, bytes: Buffer, x: number, y: number, w: number, h: number): void {
  const decoded = decodeStill(bytes);
  if (!decoded) {
    canvas.fill(x, y, w, h, [20, 40, 80]);
    return;
  }
  canvas.blit(x, y, w, h, decoded, 4);
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
