// Draws the ExamGuard icon (a shield with a check mark) and writes apps/desktop/build/icon.ico
// (256 px PNG + 48/32/16 px bitmaps, the formats Windows and NSIS read) and build/icon.png.
// No dependencies: pixels are computed here with 4×4 supersampling. Run: node scripts/make-icon.mjs
/* global Buffer, console */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repo, 'apps/desktop/build');

// Shapes in a 0..1 square.
const TOP = 0.08;
const BOTTOM = 0.94;
const HALF = 0.4;

/** Inside the shield: a flat top with rounded corners, straight sides, then a curve to the point. */
function inShield(x, y) {
  const dx = Math.abs(x - 0.5);
  if (y < TOP || y > BOTTOM || dx > HALF) return false;
  const r = 0.09;
  if (y < TOP + r && dx > HALF - r) {
    const cx = HALF - r;
    const cy = TOP + r;
    if ((dx - cx) ** 2 + (y - cy) ** 2 > r * r) return false;
  }
  const shoulder = 0.46;
  if (y <= shoulder) return true;
  // From the shoulder the sides curve in to a point at the bottom.
  const t = (y - shoulder) / (BOTTOM - shoulder);
  return dx <= HALF * (1 - t * t);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

const CHECK = [
  [0.3, 0.5],
  [0.45, 0.65],
  [0.71, 0.36],
];
const CHECK_WIDTH = 0.065;

function inCheck(x, y) {
  for (let i = 0; i < CHECK.length - 1; i += 1) {
    const [ax, ay] = CHECK[i];
    const [bx, by] = CHECK[i + 1];
    if (distanceToSegment(x, y, ax, ay, bx, by) <= CHECK_WIDTH) return true;
  }
  return false;
}

/** Straight RGBA, `size`×`size`, top row first. */
function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let shield = 0;
      let check = 0;
      for (let sy = 0; sy < n; sy += 1) {
        for (let sx = 0; sx < n; sx += 1) {
          const x = (px + (sx + 0.5) / n) / size;
          const y = (py + (sy + 0.5) / n) / size;
          if (inShield(x, y)) {
            shield += 1;
            if (inCheck(x, y)) check += 1;
          }
        }
      }
      const alpha = shield / (n * n);
      const white = shield === 0 ? 0 : check / shield;
      // A vertical blue gradient: #3b82f6 at the top to #1e3a8a at the bottom.
      const t = py / size;
      const blue = [0x3b + (0x1e - 0x3b) * t, 0x82 + (0x3a - 0x82) * t, 0xf6 + (0x8a - 0xf6) * t];
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) pixels[i + c] = Math.round(blue[c] + (255 - blue[c]) * white);
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 32-bit DIB icon image: BITMAPINFOHEADER, BGRA rows bottom-up, then the 1-bit AND mask. */
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // colour + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const colour = Buffer.alloc(size * size * 4);
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y += 1) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const o = (row * size + x) * 4;
      colour[o] = rgba[i + 2];
      colour[o + 1] = rgba[i + 1];
      colour[o + 2] = rgba[i];
      colour[o + 3] = rgba[i + 3];
      if (rgba[i + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, colour, mask]);
}

function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

mkdirSync(out, { recursive: true });
const big = render(256);
const images = [{ size: 256, data: png(256, big) }];
for (const size of [48, 32, 16]) images.push({ size, data: dib(size, render(size)) });
writeFileSync(join(out, 'icon.ico'), ico(images));
writeFileSync(join(out, 'icon.png'), png(256, big));
console.log(`Wrote ${join(out, 'icon.ico')} and icon.png`);
