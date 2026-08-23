// Polygon extraction and cleanup: Moore boundary trace -> RDP -> rectilinear
// line fit (axis-snap by refitting edges as lines and intersecting them).

const NEIGHBORS8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

// Moore-neighbour contour trace with Jacob's stopping criterion: the walk ends
// only when the start pixel is re-entered travelling the same way. Stopping on
// position alone truncates the ring whenever a 1px isthmus makes the walk pass
// through the start pixel mid-loop, silently dropping part of the outline.
export const traceComponentBoundary = (labels, width, height, componentId) => {
  let startX = -1;
  let startY = -1;
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === componentId) {
      startX = i % width;
      startY = (i / width) | 0;
      break;
    }
  }
  if (startX < 0) return [];

  const isTarget = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === componentId;

  let hasNeighbor = false;
  for (const [dx, dy] of NEIGHBORS8) {
    if (isTarget(startX + dx, startY + dy)) {
      hasNeighbor = true;
      break;
    }
  }
  if (!hasNeighbor) return [{ x: startX, y: startY }];

  // The walk state is (pixel, backtrack direction); one full circuit ends when
  // that state repeats, which is Jacob's criterion.
  const boundary = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  let prevDir = 6;
  let firstX = -1;
  let firstY = -1;
  let firstDir = -1;
  const maxIter = width * height * 2;

  for (let iter = 0; iter < maxIter; iter += 1) {
    const scanStart = (prevDir + 1) % 8;
    let found = false;
    for (let i = 0; i < 8; i += 1) {
      const d = (scanStart + i) % 8;
      const nx = cx + NEIGHBORS8[d][0];
      const ny = cy + NEIGHBORS8[d][1];
      if (isTarget(nx, ny)) {
        cx = nx;
        cy = ny;
        prevDir = (d + 4) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (firstDir < 0) {
      firstX = cx;
      firstY = cy;
      firstDir = prevDir;
    } else if (cx === firstX && cy === firstY && prevDir === firstDir) {
      break;
    }
    boundary.push({ x: cx, y: cy });
  }

  // The circuit closes back onto the start pixel; drop the duplicate so the
  // ring has no zero-length edge.
  while (boundary.length > 1) {
    const last = boundary[boundary.length - 1];
    if (last.x === startX && last.y === startY) boundary.pop();
    else break;
  }
  return boundary;
};

const perpDistSq = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const pdx = point.x - (start.x + t * dx);
  const pdy = point.y - (start.y + t * dy);
  return pdx * pdx + pdy * pdy;
};

const rdpCollect = (points, lo, hi, epsSq, keep) => {
  if (hi - lo < 2) return;
  let maxDistSq = 0;
  let index = -1;
  for (let i = lo + 1; i < hi; i += 1) {
    const d = perpDistSq(points[i], points[lo], points[hi]);
    if (d > maxDistSq) {
      maxDistSq = d;
      index = i;
    }
  }
  if (maxDistSq > epsSq && index !== -1) {
    rdpCollect(points, lo, index, epsSq, keep);
    keep.push(index);
    rdpCollect(points, index, hi, epsSq, keep);
  }
};

const simplifyRdp = (points, epsilon = 2) => {
  if (!points || points.length < 3) return points ? points.slice() : [];
  const epsSq = epsilon * epsilon;
  const keep = [0];
  rdpCollect(points, 0, points.length - 1, epsSq, keep);
  keep.push(points.length - 1);
  keep.sort((a, b) => a - b);
  return keep.map((i) => points[i]);
};

// Simplify a closed pixel ring: rotate so RDP anchors at a corner-ish point,
// run RDP, drop the duplicated endpoint.
export const simplifyRing = (ring, epsilon = 2) => {
  if (ring.length < 4) return ring.slice();
  // Anchor at the point farthest from the centroid (very likely a corner).
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  let anchor = 0;
  let bestD = -1;
  for (let i = 0; i < ring.length; i += 1) {
    const dx = ring[i].x - cx;
    const dy = ring[i].y - cy;
    const d = dx * dx + dy * dy;
    if (d > bestD) {
      bestD = d;
      anchor = i;
    }
  }
  const rotated = ring.slice(anchor).concat(ring.slice(0, anchor));
  rotated.push(rotated[0]);
  const simplified = simplifyRdp(rotated, epsilon);
  simplified.pop();
  return simplified;
};

const segClass = (a, b, tolDeg) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  if (angle <= tolDeg || angle >= 180 - tolDeg) return 'h';
  if (Math.abs(angle - 90) <= tolDeg) return 'v';
  return 'd';
};

const intersectLines = (l1, l2, fallback) => {
  if (l1.kind === 'h' && l2.kind === 'h') return fallback;
  if (l1.kind === 'v' && l2.kind === 'v') return fallback;
  if (l1.kind === 'h' && l2.kind === 'v') return { x: l2.c, y: l1.c };
  if (l1.kind === 'v' && l2.kind === 'h') return { x: l1.c, y: l2.c };
  const toParam = (l) => {
    if (l.kind === 'h') return { px: 0, py: l.c, dx: 1, dy: 0 };
    if (l.kind === 'v') return { px: l.c, py: 0, dx: 0, dy: 1 };
    return { px: l.a.x, py: l.a.y, dx: l.b.x - l.a.x, dy: l.b.y - l.a.y };
  };
  const p = toParam(l1);
  const q = toParam(l2);
  const denom = p.dx * q.dy - p.dy * q.dx;
  if (Math.abs(denom) < 1e-9) return fallback;
  const t = ((q.px - p.px) * q.dy - (q.py - p.py) * q.dx) / denom;
  return { x: p.px + t * p.dx, y: p.py + t * p.dy };
};

// Fit a simplified ring to a rectilinear(+diagonal) polygon: refit each edge
// as an axis-aligned (or free) line, merge near-collinear neighbours, insert
// perpendicular jogs between parallel lines, and intersect consecutive lines.
export const rectilinearFit = (ring, options = {}) => {
  const tolDeg = options.angleTolDeg ?? 14;
  const mergeTol = options.mergeTol ?? 3;
  const n = ring.length;
  if (n < 3) return ring.slice();

  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const kind = segClass(a, b, tolDeg);
    if (kind === 'h') {
      lines.push({ kind, c: (a.y + b.y) / 2, weight: len, a, b });
    } else if (kind === 'v') {
      lines.push({ kind, c: (a.x + b.x) / 2, weight: len, a, b });
    } else {
      lines.push({ kind, weight: len, a, b });
    }
  }
  if (lines.length < 3) return ring.slice();

  // Merge consecutive same-orientation lines that sit on ~the same coordinate
  // (RDP jitter along one wall face). Wrap-aware single pass repeated until
  // stable, bounded to avoid pathological loops.
  let merged = lines;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    const next = [];
    for (const line of merged) {
      const prev = next[next.length - 1];
      if (
        prev && line.kind !== 'd' && prev.kind === line.kind
        && Math.abs(prev.c - line.c) <= mergeTol
      ) {
        const w = prev.weight + line.weight;
        prev.c = (prev.c * prev.weight + line.c * line.weight) / w;
        prev.weight = w;
        prev.b = line.b;
        changed = true;
        continue;
      }
      next.push({ ...line });
    }
    if (next.length > 1) {
      const first = next[0];
      const last = next[next.length - 1];
      if (first.kind !== 'd' && first.kind === last.kind && Math.abs(first.c - last.c) <= mergeTol) {
        const w = first.weight + last.weight;
        first.c = (first.c * first.weight + last.c * last.weight) / w;
        first.weight = w;
        first.a = last.a;
        next.pop();
        changed = true;
      }
    }
    merged = next;
    if (!changed) break;
  }
  if (merged.length < 3) return ring.slice();

  // Insert a perpendicular jog between consecutive parallel lines (a real step
  // whose short connector RDP dropped).
  const withJogs = [];
  for (let i = 0; i < merged.length; i += 1) {
    const curr = merged[i];
    const nextLine = merged[(i + 1) % merged.length];
    withJogs.push(curr);
    if (curr.kind !== 'd' && curr.kind === nextLine.kind) {
      const jogKind = curr.kind === 'h' ? 'v' : 'h';
      const c = curr.kind === 'h'
        ? (curr.b.x + nextLine.a.x) / 2
        : (curr.b.y + nextLine.a.y) / 2;
      withJogs.push({ kind: jogKind, c, weight: 0.1, a: curr.b, b: nextLine.a });
    }
  }

  const m = withJogs.length;
  const out = [];
  for (let i = 0; i < m; i += 1) {
    const prev = withJogs[(i + m - 1) % m];
    const curr = withJogs[i];
    const fallback = { x: curr.a.x, y: curr.a.y };
    const v = intersectLines(prev, curr, fallback);
    out.push(v);
  }

  // Drop duplicate/collinear leftovers.
  const cleaned = [];
  for (const p of out) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.75 && Math.abs(prev.y - p.y) < 0.75) continue;
    cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.x - last.x) < 0.75 && Math.abs(first.y - last.y) < 0.75) cleaned.pop();
  }
  for (let i = cleaned.length - 2; i >= 1; i -= 1) {
    if (perpDistSq(cleaned[i], cleaned[i - 1], cleaned[i + 1]) < 0.25) cleaned.splice(i, 1);
  }
  return cleaned.length >= 3 ? cleaned : ring.slice();
};

// Signed shoelace. Everything that needs an area, a centroid or a winding
// derives from this one primitive; taking the absolute value too early hides
// self-intersection (lobes cancel and the area silently under-reports).
export const polygonSignedArea = (polygon) => {
  if (!polygon || polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

export const polygonArea = (polygon) => Math.abs(polygonSignedArea(polygon));

// Outer ring minus its holes, never below zero.
export const ringSetArea = (outer, holes = []) => {
  const gross = polygonArea(outer);
  let voids = 0;
  for (const hole of holes ?? []) voids += polygonArea(hole);
  return Math.max(0, gross - voids);
};

// Ray-cast containment (even-odd), holes subtracted.
export const pointInPolygon = (point, polygon, holes = []) => {
  const inRing = (ring) => {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };
  if (!inRing(polygon)) return false;
  for (const hole of holes ?? []) if (inRing(hole)) return false;
  return true;
};

// Dominant edge orientation of a ring, folded into (-45°, 45°]. Scans and
// phone photos routinely sit 1-8° off axis; fitting such a ring directly to
// the image axes flattens the shape while leaving the area almost unchanged,
// so no area- or bbox-based check can catch it.
const ringSkewAngle = (ring) => {
  if (!ring || ring.length < 8) return 0;
  const BINS = 180; // 0.5-degree resolution over 90 degrees
  const hist = new Float64Array(BINS);
  const quarter = Math.PI / 2;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    let angle = Math.atan2(dy, dx) % quarter;
    if (angle < 0) angle += quarter;
    const bin = Math.min(BINS - 1, Math.floor((angle / quarter) * BINS));
    hist[bin] += len;
  }
  // Smooth so a chamfer or a bay does not out-vote the dominant wall run.
  let best = 0;
  let bestMass = -1;
  for (let i = 0; i < BINS; i += 1) {
    const mass = hist[(i + BINS - 1) % BINS] + hist[i] * 2 + hist[(i + 1) % BINS];
    if (mass > bestMass) {
      bestMass = mass;
      best = i;
    }
  }
  let angle = ((best + 0.5) / BINS) * quarter;
  if (angle > quarter / 2) angle -= quarter;
  return angle;
};

const rotatePoints = (points, angle, cx, cy) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
};

// Rectilinear fit with de-skew: estimate the ring's dominant orientation, fit
// in that frame, and rotate back. A skewed plan then keeps its true corners
// instead of being squashed onto the image axes.
//
// `skewDeg` is what was *measured* and is reported whether or not it was
// corrected — past `maxSkewDeg` the de-skew is refused and the ring is squashed
// onto the image axes, which is the case worth telling the user about and the
// one the applied `skew` (0 there) cannot describe.
export const fitRing = (ring, options = {}) => {
  const maxSkewDeg = options.maxSkewDeg ?? 20;
  const minSkewDeg = options.minSkewDeg ?? 0.75;
  const skew = options.skewAngle ?? ringSkewAngle(ring);
  const skewDeg = Math.abs(skew * 180 / Math.PI);
  if (skewDeg < minSkewDeg || skewDeg > maxSkewDeg) {
    return { polygon: rectilinearFit(ring, options), skew: 0, skewDeg, deskewed: false };
  }
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const straight = rotatePoints(ring, -skew, cx, cy);
  const fitted = rectilinearFit(straight, options);
  return { polygon: rotatePoints(fitted, skew, cx, cy), skew, skewDeg, deskewed: true };
};

export const polygonBounds = (polygon) => {
  if (!polygon?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

export const mapPolygonToOriginal = (polygon, scaleX, scaleY) =>
  polygon.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY }));
