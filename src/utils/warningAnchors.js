// Where on the image a warning is talking about, in original image px.
//
// Anchors are derived here at render time from live store state rather than
// stored on the warning, and that is the point: a crop, a rotate or a
// hand-edited vertex cannot leave an anchor pointing at the wrong part of the
// image, because there is nothing stored to go stale.

// Codes with no geometry to point at yet. Declared rather than left implicit so
// a guard test can tell "nothing to show" from "nobody wrote the resolver" —
// a warning added later must not become silently unclickable.
export const UNANCHORED = new Set([
  'no-boundary', 'floor-empty',
  'bridged-opening', 'brush-mismatch', 'thin-structure-excluded',
  'drawn-freehand', 'floors-rejected', 'no-alternative',
]);

// Warnings about the outline as a whole. The honest highlight is "this
// outline": weak, but it does not claim to know a part of the shape it does
// not know.
const WHOLE_OUTLINE = new Set([
  'unsealed', 'self-intersecting', 'covers-page', 'tiny-floor', 'no-inner',
  'inner-not-nested', 'inner-over-inset', 'incomplete-enclosure',
  'wall-left-outside', 'annexation', 'heavy-closing', 'weak-wall-support',
]);

const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

const ringOf = (trace) => {
  const points = (trace?.vertices ?? []).filter(finite).map(({ x, y }) => ({ x, y }));
  return points.length >= 3 ? points : null;
};

const rectAnchor = (rect) => {
  if (!rect) return null;
  const x = Math.min(rect.left, rect.right);
  const y = Math.min(rect.top, rect.bottom);
  const width = Math.abs(rect.right - rect.left);
  const height = Math.abs(rect.bottom - rect.top);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0) || !(height > 0)) return null;
  return { kind: 'rect', x, y, width, height };
};

const ownRing = (ctx) => {
  const ring = ringOf(ctx?.trace);
  return ring ? { kind: 'ring', rings: [ring] } : null;
};

// Both floors, by index into the trace list. Detection writes one trace per
// floor in the same order, so the indices line up until the user adds or
// removes a trace — after which the outline this warning was raised against no
// longer exists, and its own ring is the most that can honestly be shown.
const overlapAnchor = (warning, ctx) => {
  const indices = warning.detail?.floors;
  const rings = Array.isArray(indices)
    ? indices.map((i) => ringOf(ctx?.traces?.[i])).filter(Boolean)
    : [];
  return rings.length ? { kind: 'ring', rings } : ownRing(ctx);
};

// The labels themselves. `detail.points` is what validate.js records; the name
// fallback is for traces made before it did, and is ambiguous whenever two
// labels read the same — which is why the points exist.
const labelAnchor = (warning, ctx) => {
  const recorded = (warning.detail?.points ?? []).filter(finite).map(({ x, y }) => ({ x, y }));
  if (recorded.length) return { kind: 'point', points: recorded };
  const named = (warning.detail?.names ?? []).flatMap((name) => {
    const label = (ctx?.detectedDimensions ?? []).find((d) => d.text === name && d.bbox);
    return label
      ? [{ x: label.bbox.x + label.bbox.width / 2, y: label.bbox.y + label.bbox.height / 2 }]
      : [];
  });
  return named.length ? { kind: 'point', points: named } : null;
};

/**
 * @param {object} warning one entry of a trace's `quality.warnings`
 * @param {object} ctx { trace, traces, rooms, detectedDimensions } from the store
 * @returns {object|null} an anchor in original image px:
 *   {kind:'ring', rings}, {kind:'rect', x, y, width, height} or
 *   {kind:'point', points}. Null when nothing can be pointed at.
 */
export const resolveAnchor = (warning, ctx) => {
  const code = warning?.code;
  if (!code || UNANCHORED.has(code)) return null;
  if (WHOLE_OUTLINE.has(code)) return ownRing(ctx);
  if (code === 'floors-overlap') return overlapAnchor(warning, ctx);
  if (code === 'label-outside') return labelAnchor(warning, ctx);
  if (code === 'room-outside') {
    // The rect the detector was handed, in original px. Preferred over the name
    // because rooms are written with `name: null`, and two rooms can share one.
    const anchor = rectAnchor(warning.detail?.rect);
    if (anchor) return anchor;
    const name = warning.detail?.name;
    if (!name) return null;
    return rectAnchor((ctx?.rooms ?? []).find((r) => r.name === name && r.rect)?.rect);
  }
  return null;
};

/** Bounding box of an anchor, for the camera to test against the viewport. */
export const anchorBounds = (anchor) => {
  if (!anchor) return null;
  if (anchor.kind === 'rect') {
    return {
      minX: anchor.x, minY: anchor.y,
      maxX: anchor.x + anchor.width, maxY: anchor.y + anchor.height,
    };
  }
  const points = anchor.kind === 'ring' ? (anchor.rings ?? []).flat() : (anchor.points ?? []);
  if (!points.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};
