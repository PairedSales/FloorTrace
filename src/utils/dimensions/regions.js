/**
 * Spatial text-region analysis.
 *
 * Finds glyph-sized connected components in an ink mask and clusters them
 * into horizontal and vertical text-line candidates. These candidate boxes
 * drive the targeted ROI re-OCR passes (including rotated OCR for vertical
 * labels, which full-page OCR misses entirely).
 *
 * Works on the analysis-scale ink mask from raster.binarizeInk().
 */

const MAX_GLYPH_SIZE = 64;
const MIN_GLYPH_HEIGHT = 4;
const MIN_GLYPH_PIXELS = 4;

/** 8-connected component labelling; returns glyph-sized component boxes. */
const extractGlyphs = (ink) => {
  const { data, width, height } = ink;
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const glyphs = [];
  let label = 0;

  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue;
    label++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;

    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let count = 0;

    while (sp > 0) {
      const p = stack[--sp];
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Early bail on components already too large to be a glyph
      if (maxX - minX > MAX_GLYPH_SIZE * 2 || maxY - minY > MAX_GLYPH_SIZE * 2) {
        // Finish labelling the component without tracking (so we skip it once)
        while (sp > 0) {
          const q = stack[--sp];
          const qx = q % width;
          const qy = (q / width) | 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = qx + dx;
              const ny = qy + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const n = ny * width + nx;
              if (data[n] && !labels[n]) {
                labels[n] = label;
                stack[sp++] = n;
              }
            }
          }
        }
        count = -1;
        break;
      }

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (data[n] && !labels[n]) {
            labels[n] = label;
            stack[sp++] = n;
          }
        }
      }
    }

    if (count < MIN_GLYPH_PIXELS) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (h < MIN_GLYPH_HEIGHT && w < MIN_GLYPH_HEIGHT) continue;
    if (w > MAX_GLYPH_SIZE || h > MAX_GLYPH_SIZE) continue;
    // Structural fills (walls) are near-solid rectangles; glyphs are not
    if (count > w * h * 0.9 && w > 8 && h > 8) continue;
    if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) continue;

    glyphs.push({
      x: minX, y: minY, w, h,
      cx: minX + w / 2, cy: minY + h / 2
    });
  }

  return glyphs;
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

/**
 * Greedy 1-D clustering of glyphs into text lines.
 * `axis` = 'x' clusters left-to-right rows, 'y' clusters top-to-bottom columns.
 */
const clusterGlyphs = (glyphs, axis, maxGap) => {
  const along = axis === 'x'
    ? { pos: (g) => g.cx, side: (g) => g.cy, sideSize: (g) => g.h, min: (g) => g.x, max: (g) => g.x + g.w }
    : { pos: (g) => g.cy, side: (g) => g.cx, sideSize: (g) => g.w, min: (g) => g.y, max: (g) => g.y + g.h };

  const sorted = [...glyphs].sort((a, b) => along.pos(a) - along.pos(b));
  const clusters = [];

  for (const g of sorted) {
    let bestCluster = null;
    let bestGap = Infinity;

    for (const c of clusters) {
      const sideTol = 0.7 * Math.max(along.sideSize(g), c.sideMedian);
      if (Math.abs(along.side(g) - c.side) > sideTol) continue;
      const gap = along.min(g) - c.maxAlong;
      if (gap > maxGap || gap < -c.maxAlong) continue;
      if (gap < bestGap) {
        bestGap = gap;
        bestCluster = c;
      }
    }

    if (bestCluster) {
      bestCluster.glyphs.push(g);
      bestCluster.maxAlong = Math.max(bestCluster.maxAlong, along.max(g));
      const n = bestCluster.glyphs.length;
      bestCluster.side += (along.side(g) - bestCluster.side) / n;
      bestCluster.sideMedian = median(bestCluster.glyphs.map(along.sideSize));
    } else {
      clusters.push({
        glyphs: [g],
        maxAlong: along.max(g),
        side: along.side(g),
        sideMedian: along.sideSize(g)
      });
    }
  }

  return clusters.map((c) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const g of c.glyphs) {
      if (g.x < minX) minX = g.x;
      if (g.y < minY) minY = g.y;
      if (g.x + g.w > maxX) maxX = g.x + g.w;
      if (g.y + g.h > maxY) maxY = g.y + g.h;
    }
    return {
      x: minX, y: minY,
      width: maxX - minX, height: maxY - minY,
      glyphCount: c.glyphs.length
    };
  });
};

/**
 * Detect candidate text lines in an ink mask.
 * @returns {{horizontal: Array, vertical: Array, glyphHeight: number}}
 *   Boxes are in ink-mask pixel coordinates.
 */
export const findTextRegions = (ink) => {
  const glyphs = extractGlyphs(ink);
  if (glyphs.length === 0) return { horizontal: [], vertical: [], glyphHeight: 0 };

  const glyphHeight = median(glyphs.map((g) => g.h)) || 10;
  const maxGap = Math.max(6, glyphHeight * 2.5);

  const horizontal = clusterGlyphs(glyphs, 'x', maxGap).filter((b) =>
    b.glyphCount >= 3 &&
    b.height >= MIN_GLYPH_HEIGHT && b.height <= 72 &&
    b.width / Math.max(1, b.height) >= 1.4 &&
    b.width <= ink.width * 0.5
  );

  // Glyphs already absorbed into a solid horizontal line shouldn't seed
  // vertical columns (every row of horizontal text is also a weak column).
  const claimed = new Set();
  for (const line of horizontal) {
    if (line.glyphCount < 4) continue;
    for (const g of glyphs) {
      if (g.cx >= line.x && g.cx <= line.x + line.width &&
          g.cy >= line.y && g.cy <= line.y + line.height) {
        claimed.add(g);
      }
    }
  }
  const leftovers = glyphs.filter((g) => !claimed.has(g));

  const vertical = clusterGlyphs(leftovers, 'y', maxGap).filter((b) =>
    b.glyphCount >= 4 &&
    b.width >= MIN_GLYPH_HEIGHT && b.width <= 72 &&
    b.height / Math.max(1, b.width) >= 1.4 &&
    b.height <= ink.height * 0.5
  );

  return { horizontal, vertical, glyphHeight };
};
