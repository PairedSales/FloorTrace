// What is drawn on the plan, stated once.
//
// The plan is white paper with black ink on it, so everything laid over it has
// to be dark enough to read there and must never pass for the plan's own print.
// The rule the whole canvas follows: what is lit is what is counted. The space
// inside a GLA outline stays as bright as the paper; everything else sits under
// a light veil. An outline is a thin line on the wall's edge with a translucent
// band laid over the wall inside it, so the wall it follows still shows through.
//
// Import-free on purpose: the tests read it in node, and `canvasUtils.js`
// touches `document` at import.

export const INK = '#16161D';
export const PAPER = '#FFFFFF';
// The chrome's violet (`--accent`): the hue a GLA outline is drawn in.
export const ACCENT = '#5B3FD6';
// The scale: the room it came from and a length the user gave. The panel calls
// that room "the green box", so this hue is not free to change.
export const SCALE = '#157347';
export const SCALE_INK = '#0F5132';
export const SCALE_TINT = '#DCEFE5';
// A refusal, and anything that is not being applied.
export const CRIT = '#B42318';
// A scale line that has no length yet.
export const PENDING = '#5F5F6B';

// One grey at one strength over everything that is not counted.
export const VEIL = { color: '#6E6E84', opacity: 0.2 };

// Screen px. The band is laid inside the outline's edge, over the wall.
export const BAND = { lit: 10, other: 8, opacity: 0.3, emphasis: 0.4 };

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

const parse = (hex) => {
  const clean = String(hex ?? '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((ch) => ch + ch).join('') : clean;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (rgb) => `#${rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast of a colour against the white paper, 1 to 21. */
export const contrastOnPaper = (hex) => {
  const rgb = parse(hex);
  return rgb ? 1.05 / (luminance(rgb) + 0.05) : 1;
};

const darkened = new Map();

// The same hue taken toward black until it reaches `ratio` on white. A trace's
// colour is saved with the plan, and plans saved before this palette carry
// pastels made for a dark ground: 1.8:1 on paper. Rather than rewrite a saved
// colour, it is drawn as the nearest shade of itself that can be read.
const atLeast = (hex, ratio) => {
  const key = `${hex}|${ratio}`;
  const hit = darkened.get(key);
  if (hit) return hit;
  let rgb = parse(hex) ?? parse(ACCENT);
  for (let i = 0; i < 40 && 1.05 / (luminance(rgb) + 0.05) < ratio; i += 1) {
    rgb = rgb.map((v) => v * 0.94);
  }
  const out = toHex(rgb);
  if (darkened.size > 400) darkened.clear();
  darkened.set(key, out);
  return out;
};

/** A line or a band: 3:1, what a graphic needs. */
export const lineColor = (hex) => atLeast(hex, 3);
/** A filled label carrying white text. */
export const solidColor = (hex) => atLeast(hex, 4.5);
/** Text in the outline's own hue on a white label. */
export const inkColor = (hex) => atLeast(hex, 7);

/** The colour mixed toward white: the hairline round a white label. */
export const tintColor = (hex, amount = 0.6) => {
  const rgb = parse(hex) ?? parse(ACCENT);
  return toHex(rgb.map((v) => v + (255 - v) * amount));
};

export const withAlpha = (hex, alpha) => {
  const [r, g, b] = parse(hex) ?? parse(ACCENT);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
