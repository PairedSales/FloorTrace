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
 * The mark is drawn on transparency, with no tile behind it. In the app it is
 * `currentColor` over whatever surface it sits on and carries no background of
 * its own; a dark rounded square was the one place the icons disagreed, and at
 * icon sizes that square is most of what you see.
 *
 * Which leaves the colour, and only the SVG can answer it honestly: it carries
 * both themes' `--fg` behind a `prefers-color-scheme` query, which is the same
 * thing `currentColor` does in the menu bar. The rasters cannot switch with the
 * tab bar, so they take one tone that survives both — the midpoint of the two
 * themes' `--fg-3`, which is the token the menu bar draws the mark in. A glyph
 * in either theme's `--fg` is invisible against the other, which is the bug
 * `FloorTraceMark.jsx` documents having already fixed once.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { MARK_FRAME, MARK_WALLS, MARK_STROKE } from '../src/components/markGeometry.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GLYPH_LIGHT = '#171c22'; // --fg, light theme
const GLYPH_DARK = '#edf1f5'; // --fg, dark theme
const GLYPH = [0x77, 0x82, 0x8f]; // between the two themes' --fg-3

// Blank border, as a fraction of the icon, outside the *stroked* mark — the
// mark's own frame plus the half stroke that sits outside it. The tile used to
// need a wide inset to keep the glyph clear of its rounded corners; with the
// tile gone that inset is just a smaller mark in the same 16 px.
const MARGIN = 0.06;
const MIN_STROKE = 1.3;

// What the margin is measured against: the frame with a half stroke on each side.
const STROKED_SIZE = MARK_FRAME.size + MARK_STROKE;

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

const renderIcon = (size) => {
  const margin = size * MARGIN;
  const scale = (size - 2 * margin) / STROKED_SIZE;
  const stroke = Math.max(MARK_STROKE * scale, MIN_STROKE);
  const half = stroke / 2;
  // Mark space (0..16) → pixels, with the frame's stroke seated on the margin.
  const to = (u) => margin + half + (u - MARK_FRAME.x) * scale;

  const frameCx = to(MARK_FRAME.x + MARK_FRAME.size / 2);
  const frameHalf = (MARK_FRAME.size * scale) / 2;
  const frameR = MARK_FRAME.r * scale;
  const walls = MARK_WALLS.map(([[x1, y1], [x2, y2]]) => [to(x1), to(y1), to(x2), to(y2)]);

  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      let d = Math.abs(sdRoundRect(px, py, frameCx, frameCx, frameHalf, frameHalf, frameR)) - half;
      for (const [ax, ay, bx, by] of walls) d = Math.min(d, sdSegment(px, py, ax, ay, bx, by) - half);

      const i = (size * y + x) << 2;
      // Straight alpha: the glyph colour everywhere, coverage in the alpha, so
      // an edge blends with whatever the icon is actually shown against.
      for (let c = 0; c < 3; c++) png.data[i + c] = GLYPH[c];
      png.data[i + 3] = Math.round(clamp01(0.5 - d) * 255);
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

// The same seating the raster path uses, so the SVG and the PNGs are one icon.
const svgMarkup = () => {
  const box = STROKED_SIZE / (1 - 2 * MARGIN);
  const offset = box * MARGIN + MARK_STROKE / 2 - MARK_FRAME.x;
  const r = (n) => +n.toFixed(3);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(box)} ${r(box)}">`,
    '  <style>',
    `    .mark { stroke: ${GLYPH_LIGHT} }`,
    `    @media (prefers-color-scheme: dark) { .mark { stroke: ${GLYPH_DARK} } }`,
    '  </style>',
    `  <g class="mark" transform="translate(${r(offset)} ${r(offset)})" fill="none"`,
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
write('apple-touch-icon.png', renderIcon(180));
write('android-chrome-192x192.png', renderIcon(192));
write('android-chrome-512x512.png', renderIcon(512));
write('favicon.ico', buildIco([16, 32, 48].map((size) => ({ size, data: renderIcon(size) }))));
write('icon.svg', Buffer.from(svgMarkup(), 'utf8'));
