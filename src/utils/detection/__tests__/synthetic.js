// Synthetic floorplan builders + geometry scoring shared by the detection
// tests and scripts/detectionBenchmark.mjs. Every builder returns an
// ImageData-like {width, height, data} plus the exact truth polygon it was
// drawn from, so a shape check has ground truth by construction rather than by
// recording what the tracer happened to produce.

export const createImage = (width, height, value = 255) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
};

export const fillRect = (img, x0, y0, x1, y1, value = 0) => {
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x += 1) {
      const i = (y * img.width + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = value;
      img.data[i + 2] = value;
    }
  }
};

// Wall segment of a given thickness centred on the drawn line: horizontal if
// y0 === y1, else vertical.
export const wall = (img, x0, y0, x1, y1, t = 5, value = 0) => {
  const h = Math.floor(t / 2);
  if (y0 === y1) fillRect(img, x0, y0 - h, x1, y0 - h + t - 1, value);
  else fillRect(img, x0 - h, y0, x0 - h + t - 1, y1, value);
};

// Rectangular room/building outline drawn as four walls on the centreline
// path, i.e. the outer face sits at ±t/2 of the given rectangle.
export const wallRect = (img, x0, y0, x1, y1, t = 8, value = 0) => {
  wall(img, x0, y0, x1, y0, t, value);
  wall(img, x0, y1, x1, y1, t, value);
  wall(img, x0, y0, x0, y1, t, value);
  wall(img, x1, y0, x1, y1, t, value);
};

// Outer face of a centreline rectangle drawn with stroke thickness t.
export const outerFaceRect = (x0, y0, x1, y1, t) => {
  const h = Math.floor(t / 2);
  return [
    { x: x0 - h, y: y0 - h },
    { x: x1 - h + t - 1, y: y0 - h },
    { x: x1 - h + t - 1, y: y1 - h + t - 1 },
    { x: x0 - h, y: y1 - h + t - 1 },
  ];
};

// ── geometry scoring ────────────────────────────────────────────────────────

export const toPoint = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);

export const polyBounds = (polygons) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const raw of poly) {
      const p = toPoint(raw);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return [minX, minY, maxX, maxY];
};

// Even-odd scanline rasterization onto a coarse grid.
export const rasterize = (polygon, bounds, gridW, gridH) => {
  const mask = new Uint8Array(gridW * gridH);
  const sx = gridW / Math.max(1e-6, bounds[2] - bounds[0]);
  const sy = gridH / Math.max(1e-6, bounds[3] - bounds[1]);
  const pts = polygon.map((raw) => {
    const p = toPoint(raw);
    return { x: (p.x - bounds[0]) * sx, y: (p.y - bounds[1]) * sy };
  });
  for (let gy = 0; gy < gridH; gy += 1) {
    const y = gy + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(gridW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x += 1) mask[gy * gridW + x] = 1;
    }
  }
  return mask;
};

// IoU of two polygons (each optionally a {outer, holes} ring set).
export const polygonIou = (a, b) => {
  const ringsOf = (poly) => (Array.isArray(poly) ? { outer: poly, holes: [] } : poly);
  const ra = ringsOf(a);
  const rb = ringsOf(b);
  const bounds = polyBounds([ra.outer, rb.outer]);
  const gridW = 512;
  const gridH = Math.max(32, Math.round(512 * (bounds[3] - bounds[1]) / Math.max(1, bounds[2] - bounds[0])));
  const paint = (rings) => {
    const mask = rasterize(rings.outer, bounds, gridW, gridH);
    for (const hole of rings.holes ?? []) {
      const hm = rasterize(hole, bounds, gridW, gridH);
      for (let i = 0; i < mask.length; i += 1) if (hm[i]) mask[i] = 0;
    }
    return mask;
  };
  const ma = paint(ra);
  const mb = paint(rb);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < ma.length; i += 1) {
    if (ma[i] && mb[i]) inter += 1;
    if (ma[i] || mb[i]) union += 1;
  }
  return union > 0 ? inter / union : 0;
};

export const bboxIou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
};

export const bboxOf = (overlay) => [overlay.x1, overlay.y1, overlay.x2, overlay.y2];

export const areaError = (measured, truth) => Math.abs(measured - truth) / truth;

// ── draw mode: the sloppy user ──────────────────────────────────────────────

// Deterministic pseudo-noise, so a jitter tolerance is a fixed test and not a
// flake waiting for an unlucky seed.
const wobble = (seed) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/**
 * A brush stroke someone would actually draw around `polygon`: walked at
 * `step` px, pushed `offset` px outward from the centroid, and wobbled by up to
 * `jitter` px in both axes. Returns the `{points}` stroke shape the pipeline
 * takes.
 */
export const strokeAround = (polygon, { offset = 0, jitter = 0, step = 12, seed = 1 } = {}) => {
  const pts = polygon.map(toPoint);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const points = [];
  let n = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.round(len / step));
    for (let k = 0; k < count; k += 1) {
      const t = k / count;
      let x = a.x + (b.x - a.x) * t;
      let y = a.y + (b.y - a.y) * t;
      if (offset) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.max(1e-6, Math.hypot(dx, dy));
        x += (dx / d) * offset;
        y += (dy / d) * offset;
      }
      n += 1;
      if (jitter) {
        x += wobble(seed * 7 + n) * jitter;
        y += wobble(seed * 13 + n * 3) * jitter;
      }
      points.push({ x, y });
    }
  }
  points.push(points[0]);
  return { points };
};

// ── scenario builders ───────────────────────────────────────────────────────

// A plain rectangular house with an optional opening cut into its bottom wall.
// The opening models a patio slider: the wall is interrupted but the building
// outline is unchanged, so truth is the full rectangle either way.
export const sliderHouse = (span) => {
  const img = createImage(800, 560);
  const t = 8;
  wall(img, 100, 80, 700, 80, t);
  wall(img, 100, 80, 100, 480, t);
  wall(img, 700, 80, 700, 480, t);
  const gapLo = 400 - Math.round(span / 2);
  const gapHi = 400 + Math.round(span / 2);
  wall(img, 100, 480, gapLo, 480, t);
  wall(img, gapHi, 480, 700, 480, t);
  return { img, truth: outerFaceRect(100, 80, 700, 480, t) };
};

// U-shaped footprint: the notch mouth is flanked by two long colinear runs of
// the same bottom wall, which is exactly the geometry `bridgeRuns` was told
// could not happen.
export const uPlanHouse = () => {
  const img = createImage(800, 560);
  const t = 7;
  const h = Math.floor(t / 2);
  wall(img, 100, 80, 680, 80, t);        // top
  wall(img, 100, 80, 100, 460, t);       // left
  wall(img, 680, 80, 680, 460, t);       // right
  wall(img, 100, 460, 300, 460, t);      // bottom-left
  wall(img, 480, 460, 680, 460, t);      // bottom-right
  wall(img, 300, 220, 300, 460, t);      // notch left side
  wall(img, 480, 220, 480, 460, t);      // notch right side
  wall(img, 300, 220, 480, 220, t);      // notch back
  const lo = (v) => v - h;
  const hi = (v) => v - h + t - 1;
  return {
    img,
    truth: [
      { x: lo(100), y: lo(80) }, { x: hi(680), y: lo(80) },
      { x: hi(680), y: hi(460) }, { x: hi(480), y: hi(460) },
      { x: hi(480), y: lo(220) }, { x: lo(300), y: lo(220) },
      { x: lo(300), y: hi(460) }, { x: lo(100), y: hi(460) },
    ],
  };
};

// House with a dimension string drawn `offset` px above its top wall:
// extension lines from the wall out to a dimension line carrying the
// measurement text, exactly how plans are annotated. The truth is the house,
// not the house plus the annotation strip. `withText: false` drops the
// numerals, leaving a strip that is geometrically indistinguishable from an
// attached thin-walled structure.
export const dimensionStringHouse = (offset, { withText = true } = {}) => {
  const img = createImage(800, 620);
  const t = 8;
  wallRect(img, 120, 200, 680, 520, t);
  const y = 200 - offset;
  wall(img, 120, y, 680, y, 2);            // dimension line
  wall(img, 120, y, 120, 200, 2);          // extension line (left)
  wall(img, 680, y, 680, 200, 2);          // extension line (right)
  wall(img, 400, y, 400, 200, 2);          // interior witness tick
  if (withText) {
    // Measurement glyphs sitting on the dimension line.
    for (let g = 0; g < 7; g += 1) {
      const gx = 330 + g * 16;
      fillRect(img, gx, y - 14, gx + 8, y - 3);
    }
  }
  return { img, truth: outerFaceRect(120, 200, 680, 520, t) };
};

// House with a fully-walled interior courtyard: the void is enclosed by the
// building, so it must not count as floor area. Geometry alone cannot tell a
// courtyard from a room, so the label is the evidence — the point is that the
// result can *represent* the void at all.
export const courtyardHouse = () => {
  const img = createImage(760, 600);
  const t = 8;
  wallRect(img, 100, 100, 660, 500, t);
  wallRect(img, 280, 220, 480, 400, t);
  const h = Math.floor(t / 2);
  return {
    img,
    truth: outerFaceRect(100, 100, 660, 500, t),
    // Inner face of the courtyard ring is the hole the building does not cover.
    hole: [
      { x: 280 + h + 1, y: 220 + h + 1 },
      { x: 480 - h - 1, y: 220 + h + 1 },
      { x: 480 - h - 1, y: 400 - h - 1 },
      { x: 280 + h + 1, y: 400 - h - 1 },
    ],
    label: { x: 340, y: 300, width: 80, height: 14, keyword: 'courtyard' },
  };
};

// A floor outline plus a boxed legend/title block whose bbox sits inside the
// L-shaped floor's bbox. Neither the legend nor the notch may be annexed.
export const legendPlan = () => {
  const img = createImage(1000, 640);
  const t = 8;
  const h = Math.floor(t / 2);
  // L-shaped floor.
  wall(img, 60, 60, 560, 60, t);
  wall(img, 60, 60, 60, 560, t);
  wall(img, 60, 560, 560, 560, t);
  wall(img, 560, 60, 560, 220, t);
  wall(img, 300, 220, 560, 220, t);
  wall(img, 300, 220, 300, 400, t);
  wall(img, 300, 400, 560, 400, t);
  wall(img, 560, 400, 560, 560, t);
  // Legend box drawn in hairlines, inside the L's notch.
  wall(img, 340, 250, 530, 250, 2);
  wall(img, 340, 370, 530, 370, 2);
  wall(img, 340, 250, 340, 370, 2);
  wall(img, 530, 250, 530, 370, 2);
  wall(img, 340, 290, 530, 290, 2);
  wall(img, 340, 330, 530, 330, 2);
  const lo = (v) => v - h;
  const hi = (v) => v - h + t - 1;
  return {
    img,
    truth: [
      { x: lo(60), y: lo(60) }, { x: hi(560), y: lo(60) },
      { x: hi(560), y: lo(220) }, { x: lo(300), y: lo(220) },
      { x: lo(300), y: hi(400) }, { x: hi(560), y: hi(400) },
      { x: hi(560), y: hi(560) }, { x: lo(60), y: hi(560) },
    ],
  };
};

// House plus attached garage, the garage door drawn at `doorThickness`.
export const garageHouse = (doorThickness) => {
  const img = createImage(900, 560);
  const t = 10;
  wallRect(img, 100, 80, 500, 460, t);
  wall(img, 500, 180, 760, 180, t);
  wall(img, 500, 420, 760, 420, t);
  wall(img, 760, 180, 760, 420, doorThickness);
  return { img, truth: outerFaceRect(100, 80, 500, 460, t) };
};

// Two disconnected floor outlines whose bounding boxes overlap: an L-shaped
// floor with a second, smaller plan drawn inside the L's notch.
export const nestedFloorsPlan = () => {
  const img = createImage(1100, 780);
  const t = 8;
  const h = Math.floor(t / 2);
  wall(img, 60, 60, 760, 60, t);
  wall(img, 60, 60, 60, 700, t);
  wall(img, 60, 700, 760, 700, t);
  wall(img, 760, 60, 760, 180, t);
  wall(img, 380, 180, 760, 180, t);
  wall(img, 380, 180, 380, 560, t);
  wall(img, 380, 560, 760, 560, t);
  wall(img, 760, 560, 760, 700, t);
  // Second floor plan drawn inside the notch, not touching the first.
  wallRect(img, 430, 220, 720, 520, t);
  const lo = (v) => v - h;
  const hi = (v) => v - h + t - 1;
  return {
    img,
    floors: [
      [
        { x: lo(60), y: lo(60) }, { x: hi(760), y: lo(60) },
        { x: hi(760), y: lo(180) }, { x: lo(380), y: lo(180) },
        { x: lo(380), y: hi(560) }, { x: hi(760), y: hi(560) },
        { x: hi(760), y: hi(700) }, { x: lo(60), y: hi(700) },
      ],
      outerFaceRect(430, 220, 720, 520, t),
    ],
  };
};

// Text-like ink standing in for a room label, so a constraint point sits on
// ink the way an OCR label centre always does.
const glyphs = (img, cx, cy, count = 5) => {
  for (let g = 0; g < count; g += 1) {
    const x = cx - count * 6 + g * 12;
    fillRect(img, x, cy - 6, x + 7, cy + 6);
  }
};

/**
 * A house whose exterior wall is interrupted by window openings of `gap` px on
 * every side, with an interior partition and a labelled room either side of it.
 *
 * Past a certain opening width the strict wall mask no longer holds the outline
 * together and `partitionWallNetworks` reads one building as several — corner
 * fragments plus whatever still encloses itself. The traced outline then covers
 * part of the plan and reports high confidence for it, because the label it
 * stranded belongs to a network the winning one never scored against. This is
 * the failure remediation exists for, and no closing radius reaches it.
 */
export const windowedHouse = (gap) => {
  const img = createImage(900, 700);
  const t = 9;
  const runs = (a, b, n) => {
    const out = [];
    const seg = ((b - a) - (n - 1) * gap) / n;
    let x = a;
    for (let i = 0; i < n; i += 1) {
      out.push([Math.round(x), Math.round(x + seg)]);
      x += seg + gap;
    }
    return out;
  };
  for (const [a, b] of runs(120, 780, 3)) {
    wall(img, a, 100, b, 100, t);
    wall(img, a, 560, b, 560, t);
  }
  for (const [a, b] of runs(100, 560, 3)) {
    wall(img, 120, a, 120, b, t);
    wall(img, 780, a, 780, b, t);
  }
  wall(img, 450, 100, 450, 560, 5);
  glyphs(img, 270, 326);
  glyphs(img, 590, 326);
  return {
    img,
    truth: outerFaceRect(120, 100, 780, 560, t),
    labels: [{ x: 270, y: 326, name: 'KITCHEN' }, { x: 590, y: 326, name: 'LIVING ROOM' }],
  };
};

// Two complete, separately sealed plans side by side, each with a labelled
// room, and one stray label in the gutter between them. Remediation must not
// weld them into one building to satisfy the stray: two outlines that each
// enclose their own extent are two drawings, whatever a label between them
// says.
export const twoPlansSheet = () => {
  const img = createImage(1100, 560);
  const t = 8;
  wallRect(img, 60, 60, 460, 480, t);
  wallRect(img, 640, 60, 1040, 480, t);
  glyphs(img, 260, 270);
  glyphs(img, 840, 270);
  glyphs(img, 550, 270);
  return {
    img,
    floors: [outerFaceRect(60, 60, 460, 480, t), outerFaceRect(640, 60, 1040, 480, t)],
    labels: [
      { x: 260, y: 270, name: 'LEFT ROOM' },
      { x: 840, y: 270, name: 'RIGHT ROOM' },
      { x: 550, y: 270, name: 'STRAY' },
    ],
  };
};

// Mixed wall thickness: 16px top/bottom, 4px left/right. The interior envelope
// must inset each edge by its own wall, not by one global scalar.
export const mixedThicknessHouse = () => {
  const img = createImage(700, 520);
  wall(img, 100, 90, 600, 90, 16);
  wall(img, 100, 430, 600, 430, 16);
  wall(img, 100, 90, 100, 430, 4);
  wall(img, 600, 90, 600, 430, 4);
  return {
    img,
    outerTruth: [
      { x: 98, y: 82 }, { x: 602, y: 82 }, { x: 602, y: 438 }, { x: 98, y: 438 },
    ],
    innerTruth: [
      { x: 102, y: 98 }, { x: 598, y: 98 }, { x: 598, y: 422 }, { x: 102, y: 422 },
    ],
  };
};
