/**
 * Rasterises the app mark into the icon files under `public/`.
 *
 * The geometry comes from `src/components/markGeometry.js` — the same numbers
 * the menu bar draws — so `npm run icons` is the only way these files should
 * ever change. There is no rasteriser in the dependency tree and none is worth
 * adding for three strokes: coverage is sampled from the exact signed distance
 * to each shape, which antialiases a 16 px tab icon better than downscaling a
 * large render would.
 *
 * Tile and glyph are the dark theme's `--shell` and `--fg`, matching the
 * `theme-color` meta the browser frames the app with.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { MARK_FRAME, MARK_WALLS, MARK_STROKE } from '../src/components/markGeometry.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TILE = [0x12, 0x16, 0x1b];
const GLYPH = [0xed, 0xf1, 0xf5];

// The mark's own frame, not its viewBox, is what gets seated in the tile: the
// viewBox carries padding of its own, and stacking the two leaves the glyph
// swimming in a field of background at 16 px.
const PAD = 0.17;
const CORNER = 0.22;
const MIN_STROKE = 1.3;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const sdRoundRect = (px, py, cx, cy, hx, hy, r) => {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};

const sdSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

const renderIcon = (size, { rounded = true } = {}) => {
  const pad = size * PAD;
  const scale = (size - 2 * pad) / MARK_FRAME.size;
  // Mark space (0..16) → pixels, with the frame's top-left seated at the pad.
  const to = (u) => pad + (u - MARK_FRAME.x) * scale;
  const stroke = Math.max(MARK_STROKE * scale, MIN_STROKE);
  const half = stroke / 2;

  const frameCx = to(MARK_FRAME.x + MARK_FRAME.size / 2);
  const frameHalf = (MARK_FRAME.size * scale) / 2;
  const frameR = MARK_FRAME.r * scale;
  const walls = MARK_WALLS.map(([[x1, y1], [x2, y2]]) => [to(x1), to(y1), to(x2), to(y2)]);

  const tileHalf = size / 2;
  const tileR = rounded ? size * CORNER : 0;

  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const tileCov = clamp01(0.5 - sdRoundRect(px, py, tileHalf, tileHalf, tileHalf, tileHalf, tileR));

      let d = Math.abs(sdRoundRect(px, py, frameCx, frameCx, frameHalf, frameHalf, frameR)) - half;
      for (const [ax, ay, bx, by] of walls) d = Math.min(d, sdSegment(px, py, ax, ay, bx, by) - half);
      const glyphCov = clamp01(0.5 - d) * tileCov;

      const i = (size * y + x) << 2;
      for (let c = 0; c < 3; c++) {
        // Over the tile, so a glyph edge blends with the background it sits on
        // rather than with whatever the browser paints behind the icon.
        png.data[i + c] = Math.round(TILE[c] * (1 - glyphCov) + GLYPH[c] * glyphCov);
      }
      png.data[i + 3] = Math.round(tileCov * 255);
    }
  }
  return PNG.sync.write(png);
};

// PNG-payload ICO: every browser and Windows since Vista reads it, and it is
// three files' worth of bytes rather than three bitmaps' worth.
const buildIco = (entries) => {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
};

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// The same seating the raster path uses: the frame — not the mark's viewBox —
// takes up `1 - 2 * PAD` of the tile, so the SVG and the PNGs are one icon.
const svgMarkup = () => {
  const box = MARK_FRAME.size / (1 - 2 * PAD);
  const offset = box * PAD - MARK_FRAME.x;
  const r = (n) => +n.toFixed(3);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(box)} ${r(box)}">`,
    `  <rect width="${r(box)}" height="${r(box)}" rx="${r(box * CORNER)}" fill="${hex(TILE)}" />`,
    `  <g transform="translate(${r(offset)} ${r(offset)})" fill="none" stroke="${hex(GLYPH)}"`,
    `     stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round">`,
    `    <rect x="${MARK_FRAME.x}" y="${MARK_FRAME.y}" width="${MARK_FRAME.size}" height="${MARK_FRAME.size}" rx="${MARK_FRAME.r}" />`,
    ...MARK_WALLS.map(([[x1, y1], [x2, y2]]) => `    <path d="M${x1} ${y1}L${x2} ${y2}" />`),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
};

const write = (name, data) => {
  writeFileSync(join(PUBLIC_DIR, name), data);
  console.log(`${name.padEnd(28)} ${data.length} bytes`);
};

write('favicon-16x16.png', renderIcon(16));
write('favicon-32x32.png', renderIcon(32));
// iOS masks this itself, so it ships square and opaque.
write('apple-touch-icon.png', renderIcon(180, { rounded: false }));
write('android-chrome-192x192.png', renderIcon(192));
write('android-chrome-512x512.png', renderIcon(512));
write('favicon.ico', buildIco([16, 32, 48].map((size) => ({ size, data: renderIcon(size) }))));
write('icon.svg', Buffer.from(svgMarkup(), 'utf8'));
