// Generates the PWA icons in public/ from code, so they are reproducible and
// reviewable instead of being opaque binaries: `node scripts/make-icons.mjs`.
//
// Chrome (and therefore ChromeOS) wants raster icons at 192 and 512 to offer
// "Install app", plus a maskable variant so the ChromeOS shelf/launcher can
// apply its own shape without clipping the glyph.
//
// The mark is an audio waveform in the app's own blue (--primary-color), which
// is what the app is about — listen, then type.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Matches src/index.css: --primary-color #2563eb over --primary-hover #1d4ed8.
const BLUE_TOP = [37, 99, 235];
const BLUE_BOTTOM = [29, 78, 216];
const WHITE = [255, 255, 255];

// Supersample, then box-average down — cheap anti-aliasing for the rounded
// corners and bar caps without pulling in a rasterizer.
const SS = 4;

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes an RGBA pixel buffer as a PNG. */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * 4 + 1);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance from a point to a rounded rectangle: <= 0 means inside. */
function roundedRectDistance(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * @param size    output edge length in px
 * @param maskable full-bleed background and a glyph shrunk into the safe zone,
 *                 for icons the platform will crop to its own shape
 */
function drawIcon(size, { maskable = false } = {}) {
  const big = size * SS;
  const hi = Buffer.alloc(big * big * 4);

  // Rounded-square plate. A maskable icon bleeds to the edges instead, because
  // anything the platform crops off must not be part of the artwork.
  const plateRadius = maskable ? 0 : big * 0.22;
  const plateHalf = big / 2;

  // Five waveform bars, tallest in the middle. Heights are fractions of the
  // glyph box, which is itself inset so the mark never touches the plate edge.
  const glyphScale = maskable ? 0.56 : 0.66;
  const glyphHalf = (big * glyphScale) / 2;
  const barHeights = [0.34, 0.62, 1, 0.72, 0.44];
  const barWidth = (glyphHalf * 2) / (barHeights.length * 2 - 1);
  const barRadius = barWidth / 2;

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const inPlate = maskable
        ? true
        : roundedRectDistance(px, py, plateHalf, plateHalf, plateHalf, plateHalf, plateRadius) <= 0;

      const at = (y * big + x) * 4;
      if (!inPlate) continue; // stays transparent

      // Vertical gradient across the plate.
      const t = py / big;
      hi[at] = Math.round(BLUE_TOP[0] + (BLUE_BOTTOM[0] - BLUE_TOP[0]) * t);
      hi[at + 1] = Math.round(BLUE_TOP[1] + (BLUE_BOTTOM[1] - BLUE_TOP[1]) * t);
      hi[at + 2] = Math.round(BLUE_TOP[2] + (BLUE_BOTTOM[2] - BLUE_TOP[2]) * t);
      hi[at + 3] = 255;

      for (let i = 0; i < barHeights.length; i++) {
        const cx = plateHalf - glyphHalf + barRadius + i * barWidth * 2;
        const halfH = Math.max(glyphHalf * barHeights[i], barRadius);
        if (roundedRectDistance(px, py, cx, plateHalf, barWidth / 2, halfH, barRadius) <= 0) {
          hi[at] = WHITE[0];
          hi[at + 1] = WHITE[1];
          hi[at + 2] = WHITE[2];
          hi[at + 3] = 255;
          break;
        }
      }
    }
  }

  // Box-downsample SSxSS blocks to the final resolution.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const at = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          const alpha = hi[at + 3];
          // Weight colour by alpha so transparent pixels don't darken the edge.
          r += hi[at] * alpha;
          g += hi[at + 1] * alpha;
          b += hi[at + 2] * alpha;
          a += alpha;
        }
      }
      const at = (y * size + x) * 4;
      if (a > 0) {
        out[at] = Math.round(r / a);
        out[at + 1] = Math.round(g / a);
        out[at + 2] = Math.round(b / a);
      }
      out[at + 3] = Math.round(a / (SS * SS));
    }
  }

  return encodePng(out, size);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const file = path.join(PUBLIC_DIR, name);
  fs.writeFileSync(file, drawIcon(size, options));
  console.log(`wrote ${name} (${size}x${size}, ${fs.statSync(file).size} bytes)`);
}
