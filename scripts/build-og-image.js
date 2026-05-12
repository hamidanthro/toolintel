#!/usr/bin/env node
/**
 * Builds /og-image.png at 1200×630 (the OG spec recommendation).
 *
 * Pure Node — no external dependencies. Writes a brand-colored navy
 * gradient with a soft gold ambient glow in the upper-right quadrant,
 * matching the homepage hero atmosphere. No text — Hamid can swap
 * this for a designed image when he has time. Until then, social
 * platforms get a properly-sized branded preview instead of a 404.
 *
 * Re-run: `node scripts/build-og-image.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 1200;
const HEIGHT = 630;
const OUT = path.resolve(__dirname, '..', 'og-image.png');

// Brand palette
const NAVY = [0x06, 0x0d, 0x1f];       // base body bg
const GOLD = [0xfb, 0xbf, 0x24];       // brand gold
const STAR_GOLD = [0xfd, 0xe0, 0x47];  // hero star

// PNG CRC32 (polynomial 0xEDB88320). Precompute table.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// IHDR: 13-byte header (width, height, bit-depth, color-type, …)
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: 2 = truecolor RGB
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace

// Render pixel buffer. Each scanline is prefixed by a 1-byte filter
// type (0 = none). RGB at 3 bytes per pixel.
const ROW = 1 + WIDTH * 3;
const raw = Buffer.alloc(HEIGHT * ROW);

// Soft radial highlight centered at (~70% x, ~30% y)
const cx = WIDTH * 0.7;
const cy = HEIGHT * 0.3;
const maxR = Math.max(WIDTH, HEIGHT);
// Subtle bottom-left blue ambient (matches hero ::after layer)
const bx = WIDTH * 0.15;
const by = HEIGHT * 0.85;

for (let y = 0; y < HEIGHT; y++) {
  const off = y * ROW;
  raw[off] = 0; // filter: none
  for (let x = 0; x < WIDTH; x++) {
    // Gold radial in upper-right — falls off cleanly to navy
    const dx1 = x - cx, dy1 = y - cy;
    const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) / maxR;
    const goldMix = Math.max(0, 1 - d1 * 1.7) * 0.22;

    // Cool blue accent in lower-left — very subtle
    const dx2 = x - bx, dy2 = y - by;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) / maxR;
    const blueMix = Math.max(0, 1 - d2 * 2.2) * 0.08;

    const r = Math.min(255, Math.round(NAVY[0] + (GOLD[0] - NAVY[0]) * goldMix + (0x3b - NAVY[0]) * blueMix));
    const g = Math.min(255, Math.round(NAVY[1] + (GOLD[1] - NAVY[1]) * goldMix + (0x82 - NAVY[1]) * blueMix));
    const b = Math.min(255, Math.round(NAVY[2] + (GOLD[2] - NAVY[2]) * goldMix + (0xf6 - NAVY[2]) * blueMix));

    const i = off + 1 + x * 3;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
  }
}

// Draw a simple gold 5-pointed star in the center as the brand mark.
// Math: star with outer-radius R and inner-radius R/2, 5 points,
// rotated so a point faces up. Anti-aliased via subpixel coverage.
const starCx = WIDTH / 2;
const starCy = HEIGHT / 2;
const starOuter = 110;
const starInner = starOuter * 0.382; // golden ratio
const starPath = [];
for (let i = 0; i < 10; i++) {
  const ang = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 === 0 ? starOuter : starInner;
  starPath.push({ x: starCx + Math.cos(ang) * r, y: starCy + Math.sin(ang) * r });
}

// Point-in-polygon test (ray-casting). Used per-pixel within the star's
// bounding box for an O(W·H·10) fill that's fast enough for a 1.2k×630
// one-shot render.
function inStar(px, py) {
  let inside = false;
  const n = starPath.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = starPath[i].x, yi = starPath[i].y;
    const xj = starPath[j].x, yj = starPath[j].y;
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

const bbMinX = Math.floor(starCx - starOuter - 2);
const bbMaxX = Math.ceil(starCx + starOuter + 2);
const bbMinY = Math.floor(starCy - starOuter - 2);
const bbMaxY = Math.ceil(starCy + starOuter + 2);

for (let y = bbMinY; y <= bbMaxY; y++) {
  if (y < 0 || y >= HEIGHT) continue;
  for (let x = bbMinX; x <= bbMaxX; x++) {
    if (x < 0 || x >= WIDTH) continue;
    // 4x supersampling for anti-aliased edge
    let hits = 0;
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        if (inStar(x + sx * 0.5 + 0.25, y + sy * 0.5 + 0.25)) hits++;
      }
    }
    if (hits === 0) continue;
    const cov = hits / 4;
    const i = y * ROW + 1 + x * 3;
    raw[i]     = Math.round(raw[i]     * (1 - cov) + STAR_GOLD[0] * cov);
    raw[i + 1] = Math.round(raw[i + 1] * (1 - cov) + STAR_GOLD[1] * cov);
    raw[i + 2] = Math.round(raw[i + 2] * (1 - cov) + STAR_GOLD[2] * cov);
  }
}

// Compose final PNG
const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(OUT, png);
console.log(`✓ wrote ${path.relative(path.resolve(__dirname, '..'), OUT)}  (${(png.length / 1024).toFixed(1)} KB, ${WIDTH}×${HEIGHT})`);
