import { mapPointFromNormalized } from './preprocess';
import { snapAngleToBins } from './orientation';

const neighbors4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const neighbors8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

const inBounds = (x, y, width, height) => x >= 0 && y >= 0 && x < width && y < height;

export const labelConnectedComponents = (mask, width, height, targetValue = 1) => {
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const components = [];
  let id = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (labels[start] !== -1 || mask[start] !== targetValue) continue;

      const queue = [start];
      labels[start] = id;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let size = 0;

      for (let q = 0; q < queue.length; q += 1) {
        const index = queue[q];
        const cx = index % width;
        const cy = Math.floor(index / width);
        size += 1;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        for (const [dx, dy] of neighbors4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inBounds(nx, ny, width, height)) continue;
          const nIndex = ny * width + nx;
          if (labels[nIndex] !== -1 || mask[nIndex] !== targetValue) continue;
          labels[nIndex] = id;
          queue.push(nIndex);
        }
      }

      components.push({
        id,
        size,
        bbox: { minX, minY, maxX, maxY },
      });
      id += 1;
    }
  }

  return { labels, components };
};

export const contourForComponent = (labels, width, height, componentId) => {
  const points = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (labels[idx] !== componentId) continue;

      let border = false;
      for (const [dx, dy] of neighbors8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, width, height) || labels[ny * width + nx] !== componentId) {
          border = true;
          break;
        }
      }

      if (border) {
        points.push({ x, y });
      }
    }
  }
  return points;
};

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export const convexHull = (points) => {
  if (!points?.length) return [];
  const sorted = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (sorted.length < 4) return sorted;

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

const perpendicularDistance = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return Math.sqrt(px * px + py * py);
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  const pdx = point.x - projX;
  const pdy = point.y - projY;
  return Math.sqrt(pdx * pdx + pdy * pdy);
};

export const simplifyRdp = (points, epsilon = 1.5) => {
  if (!points || points.length < 3) return points ?? [];

  let maxDist = 0;
  let index = -1;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon && index !== -1) {
    const left = simplifyRdp(points.slice(0, index + 1), epsilon);
    const right = simplifyRdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [points[0], points[end]];
};

export const snapPolygonAngles = (polygon, bins = []) => {
  if (!polygon || polygon.length < 3 || !bins.length) return polygon ?? [];
  const snapped = [polygon[0]];
  for (let i = 1; i < polygon.length; i += 1) {
    const prev = snapped[snapped.length - 1];
    const curr = polygon[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6) continue;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snappedAngle = snapAngleToBins(angle, bins);
    const rad = (snappedAngle * Math.PI) / 180;
    snapped.push({
      x: prev.x + Math.cos(rad) * length,
      y: prev.y + Math.sin(rad) * length,
    });
  }
  return snapped;
};

export const componentToPolygon = (labels, width, height, componentId, options = {}) => {
  const contour = contourForComponent(labels, width, height, componentId);
  if (!contour.length) return [];
  const hull = convexHull(contour);
  if (hull.length < 3) return hull;
  const closed = hull.concat(hull[0]);
  const simplified = simplifyRdp(closed, options.simplifyEpsilon ?? 2).slice(0, -1);
  return options.angleBins?.length ? snapPolygonAngles(simplified, options.angleBins) : simplified;
};

export const polygonToBounds = (polygon) => {
  if (!polygon?.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

export const mapPolygonFromNormalized = (polygon, scale) => polygon.map((point) => mapPointFromNormalized(point, scale));
