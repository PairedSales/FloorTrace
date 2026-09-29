// Crops of a page for reading coordinates off, and outlines drawn on them
// (scripts/realKeyTool.mjs `view`, and any tool that needs the same picture).
//
// A drawing is read through a tool that downsizes big images, which loses the
// detail a key depends on. So a view is a crop scaled up to ~1,400 px on its
// long side, with a grid labelled in the page's own pixels on all four edges,
// in a margin so no label covers ink, and a legend saying what each line is.
//
//   const { png, summary } = await renderView(bytes, {
//     crop: [x0, y0, x1, y1],            // page px; default the whole page
//     grid: 20,                          // px between grid lines; default by zoom; 0 = none
//     layers: [{                         // drawn in order, each clipped to the crop
//       label: 'A',                      // its legend entry
//       outlines: [{ type, v: [[x, y], …] }],
//       color: '#d000d0',                // or byType: true for the type colours
//       dash: [9, 6],                    // [] = solid
//       width: 2,
//       vertexNumbers: true,             // dots and `outline.vertex` numbers
//       boxes: [{ box: [x0, y0, x1, y1], text: '1' }],   // labelled rectangles
//     }],
//   });
//
// `bytes` is an encoded image (Buffer/Uint8Array) or an @napi-rs/canvas Image.
// `png` is a Buffer; `summary` is `{crop, clamped, scale, grid, width, height,
// line}`, where `crop` is what is shown (the asked one cut back to the page,
// `clamped` when it was) and `line` reads `crop x0,y0→x1,y1  scale N.NN px/px
// grid S`. A crop showing under 2 px of the page throws.
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const TYPE_COLORS = {
  gla: '#00a000',
  'below-grade': '#0a8f8f',
  garage: '#e08a00',
  porch: '#3b6eff',
  unfinished: '#8a8a8a',
};
export const TYPE_LABELS = {
  gla: 'GLA',
  'below-grade': 'Below grade',
  garage: 'Garage',
  porch: 'Porch/patio',
  unfinished: 'Unfinished (not scored)',
};

const GUTTER = 30;
const LEGEND_ROW = 20;
const MIN_SHOWN = 2;
const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

// The smallest tidy step whose lines sit at least ~40 screen px apart.
export const autoGrid = (scale) => NICE_STEPS.find((s) => s * scale >= 40) ?? 1000;

const round = (x) => Math.round(x * 100) / 100;
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(round(n)));

export const describeView = ({ crop, scale, grid }) => `crop ${crop.map(fmt).slice(0, 2).join(',')}→${crop.map(fmt).slice(2).join(',')}  scale ${scale.toFixed(2)} px/px  grid ${grid || 'none'}`;

const halo = (g, text, x, y) => {
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.strokeText(text, x, y);
  g.fillText(text, x, y);
};

const trace = (g, ring, map) => {
  g.beginPath();
  ring.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
};

export const renderView = async (source, options = {}) => {
  const img = source && typeof source.width === 'number' && !ArrayBuffer.isView(source) ? source : await loadImage(source);
  const { layers = [], longSide = 1400 } = options;
  const box = options.crop ?? [0, 0, img.width, img.height];
  // A crop that misses the page, or grazes it, would be scaled up to a picture
  // of a pixel: say so instead of drawing it.
  const shownW = Math.min(img.width, box[2]) - Math.max(0, box[0]);
  const shownH = Math.min(img.height, box[3]) - Math.max(0, box[1]);
  if (!(shownW >= MIN_SHOWN && shownH >= MIN_SHOWN)) {
    throw new Error(`the crop ${box.map(fmt).slice(0, 2).join(',')}→${box.map(fmt).slice(2).join(',')} shows ${shownW > 0 && shownH > 0 ? `only ${fmt(shownW)} x ${fmt(shownH)} px` : 'none'} of the ${img.width} x ${img.height} px image`);
  }
  const x0 = Math.max(0, Math.min(img.width - 1, box[0]));
  const y0 = Math.max(0, Math.min(img.height - 1, box[1]));
  const x1 = Math.max(x0 + 1, Math.min(img.width, box[2]));
  const y1 = Math.max(y0 + 1, Math.min(img.height, box[3]));
  const cw = x1 - x0;
  const ch = y1 - y0;
  const entries = layers.filter((l) => l.label);
  const legendRows = 1 + Math.ceil(entries.length / 2);
  const legendH = 8 + legendRows * LEGEND_ROW;
  const scale = Math.min((longSide - 2 * GUTTER) / cw, (longSide - 2 * GUTTER - legendH) / ch);
  const areaW = Math.max(1, Math.round(cw * scale));
  const areaH = Math.max(1, Math.round(ch * scale));
  const grid = options.grid === undefined || options.grid === null ? autoGrid(scale) : options.grid;
  const canvas = createCanvas(areaW + 2 * GUTTER, areaH + 2 * GUTTER + legendH);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);

  // Up close, show the pixels as pixels: a soft blur would put an edge where
  // it is not.
  g.imageSmoothingEnabled = !(scale >= 3);
  g.drawImage(img, x0, y0, cw, ch, GUTTER, GUTTER, areaW, areaH);
  const sx = areaW / cw;
  const sy = areaH / ch;
  const map = ([x, y]) => [GUTTER + (x - x0) * sx, GUTTER + (y - y0) * sy];

  // The grid: every line, a heavier one every fifth, labelled in the margin.
  g.save();
  g.beginPath();
  g.rect(GUTTER, GUTTER, areaW, areaH);
  g.clip();
  if (grid > 0) {
    for (let x = Math.ceil(x0 / grid) * grid; x <= x1; x += grid) {
      const major = Math.round(x / grid) % 5 === 0;
      g.strokeStyle = major ? 'rgba(210,0,0,0.55)' : 'rgba(0,90,220,0.38)';
      g.lineWidth = major ? 1.4 : 1;
      const [px] = map([x, 0]);
      g.beginPath();
      g.moveTo(px, GUTTER);
      g.lineTo(px, GUTTER + areaH);
      g.stroke();
    }
    for (let y = Math.ceil(y0 / grid) * grid; y <= y1; y += grid) {
      const major = Math.round(y / grid) % 5 === 0;
      g.strokeStyle = major ? 'rgba(210,0,0,0.55)' : 'rgba(0,90,220,0.38)';
      g.lineWidth = major ? 1.4 : 1;
      const [, py] = map([0, y]);
      g.beginPath();
      g.moveTo(GUTTER, py);
      g.lineTo(GUTTER + areaW, py);
      g.stroke();
    }
  }
  for (const layer of layers) {
    const dashScale = Math.max(1, (layer.width ?? 2) / 2);
    for (const [k, outline] of (layer.outlines ?? []).entries()) {
      const color = layer.byType ? (TYPE_COLORS[outline.type] ?? '#000') : (layer.color ?? '#000');
      g.strokeStyle = color;
      g.lineWidth = layer.width ?? 2;
      g.setLineDash((layer.dash ?? []).map((d) => d * dashScale));
      trace(g, outline.v, map);
      if (layer.fill) {
        g.globalAlpha = 0.14;
        g.fillStyle = color;
        g.fill();
        g.globalAlpha = 1;
      }
      g.stroke();
      g.setLineDash([]);
      if (layer.vertexNumbers) {
        g.font = 'bold 11px sans-serif';
        outline.v.forEach((p, i) => {
          if (p[0] < x0 - 20 || p[0] > x1 + 20 || p[1] < y0 - 20 || p[1] > y1 + 20) return;
          const [px, py] = map(p);
          g.fillStyle = color;
          g.beginPath();
          g.arc(px, py, 3.5, 0, Math.PI * 2);
          g.fill();
          halo(g, `${layer.outlineNumbers?.[k] ?? k}.${i}`, px + 5, py - 5);
        });
      }
    }
    for (const b of layer.boxes ?? []) {
      const [ax, ay] = map([b.box[0], b.box[1]]);
      const [bx, by] = map([b.box[2], b.box[3]]);
      g.strokeStyle = layer.color ?? '#e000e0';
      g.lineWidth = 2.5;
      g.setLineDash([]);
      g.strokeRect(ax, ay, bx - ax, by - ay);
      if (b.text) {
        g.font = 'bold 15px sans-serif';
        g.fillStyle = layer.color ?? '#e000e0';
        halo(g, b.text, ax + 3, ay - 5 < GUTTER + 12 ? by + 15 : ay - 5);
      }
    }
  }
  g.restore();
  g.strokeStyle = '#444';
  g.lineWidth = 1;
  g.strokeRect(GUTTER - 0.5, GUTTER - 0.5, areaW + 1, areaH + 1);

  // Labels in the margin, on all four edges, every line that fits.
  if (grid > 0) {
    g.font = '11px sans-serif';
    g.fillStyle = '#a00000';
    g.strokeStyle = '#a00000';
    g.lineWidth = 1;
    const every = Math.max(1, Math.ceil(30 / (grid * sx)));
    for (let x = Math.ceil(x0 / grid) * grid; x <= x1; x += grid) {
      if (Math.round(x / grid) % every !== 0) continue;
      const [px] = map([x, 0]);
      g.textAlign = 'center';
      g.fillText(fmt(x), px, GUTTER - 8);
      g.fillText(fmt(x), px, GUTTER + areaH + 19);
      g.beginPath();
      g.moveTo(px, GUTTER - 4);
      g.lineTo(px, GUTTER);
      g.moveTo(px, GUTTER + areaH);
      g.lineTo(px, GUTTER + areaH + 4);
      g.stroke();
    }
    const everyY = Math.max(1, Math.ceil(16 / (grid * sy)));
    for (let y = Math.ceil(y0 / grid) * grid; y <= y1; y += grid) {
      if (Math.round(y / grid) % everyY !== 0) continue;
      const [, py] = map([0, y]);
      g.textAlign = 'right';
      g.fillText(fmt(y), GUTTER - 6, py + 4);
      g.textAlign = 'left';
      g.fillText(fmt(y), GUTTER + areaW + 6, py + 4);
      g.beginPath();
      g.moveTo(GUTTER - 4, py);
      g.lineTo(GUTTER, py);
      g.moveTo(GUTTER + areaW, py);
      g.lineTo(GUTTER + areaW + 4, py);
      g.stroke();
    }
    g.textAlign = 'left';
  }

  // The legend: what every line is.
  const ly = GUTTER + areaH + GUTTER - 4;
  g.font = '13px sans-serif';
  g.textBaseline = 'middle';
  const gridText = grid > 0
    ? `grid every ${grid} px (heavier every ${grid * 5}); labels are image pixels; zoom ${scale.toFixed(2)}x`
    : `no grid; zoom ${scale.toFixed(2)}x`;
  g.fillStyle = '#222';
  g.fillText(gridText, GUTTER, ly + LEGEND_ROW / 2);
  entries.forEach((layer, i) => {
    const cx = GUTTER + (i % 2) * Math.floor((areaW - 8) / 2);
    const cy = ly + LEGEND_ROW * (1 + Math.floor(i / 2)) + LEGEND_ROW / 2;
    const color = layer.byType ? '#00a000' : (layer.color ?? '#000');
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.setLineDash(layer.boxes ? [] : (layer.dash ?? []).map((d) => d * Math.max(1, (layer.width ?? 2) / 2) * 0.6));
    g.beginPath();
    if (layer.boxes) g.rect(cx, cy - 6, 34, 12);
    else {
      g.moveTo(cx, cy);
      g.lineTo(cx + 34, cy);
    }
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#222';
    g.fillText(layer.label, cx + 42, cy);
  });
  g.textBaseline = 'alphabetic';

  const summary = {
    crop: [x0, y0, x1, y1],
    // The crop asked for reached past the page and was cut back to it.
    clamped: box[0] < x0 || box[1] < y0 || box[2] > x1 || box[3] > y1,
    scale,
    grid,
    width: canvas.width,
    height: canvas.height,
  };
  summary.line = describeView(summary);
  return { png: canvas.toBuffer('image/png'), summary };
};
