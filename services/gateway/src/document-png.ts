import { deflateSync } from "node:zlib";

/**
 * Uncompressed-then-deflated RGB PNG. Used as a test double and by the IR
 * compositor. Production visual QA screenshots the PPTX in LibreOffice.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crcSrc = Buffer.concat([header.subarray(4, 8), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcSrc), 0);
  return Buffer.concat([header, data, crc]);
}

export type Rgb = [number, number, number];

export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number, fill: Rgb = [255, 255, 255]) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, fill);
  }

  fill(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const [r, g, b] = color;
    for (let py = y0; py < y1; py++) {
      let i = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px++) {
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
        i += 3;
      }
    }
  }

  /** Nearest-neighbour blit of RGBA or RGB into the canvas. */
  blit(
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    src: { width: number; height: number; data: Uint8Array },
    channels = 4,
  ): void {
    const x0 = Math.max(0, Math.floor(dx));
    const y0 = Math.max(0, Math.floor(dy));
    const x1 = Math.min(this.width, Math.ceil(dx + dw));
    const y1 = Math.min(this.height, Math.ceil(dy + dh));
    const sw = Math.max(1, src.width);
    const sh = Math.max(1, src.height);
    for (let py = y0; py < y1; py++) {
      const sy = Math.min(sh - 1, Math.floor(((py - dy) / dh) * sh));
      for (let px = x0; px < x1; px++) {
        const sx = Math.min(sw - 1, Math.floor(((px - dx) / dw) * sw));
        const si = (sy * sw + sx) * channels;
        const di = (py * this.width + px) * 3;
        this.pixels[di] = src.data[si] ?? 0;
        this.pixels[di + 1] = src.data[si + 1] ?? 0;
        this.pixels[di + 2] = src.data[si + 2] ?? 0;
      }
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      const row = y * (this.width * 3 + 1);
      raw[row] = 0;
      raw.set(this.pixels.subarray(y * this.width * 3, (y + 1) * this.width * 3), row + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/** 1×1 PNG for tests and skipped image slots. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
