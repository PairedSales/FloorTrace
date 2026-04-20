import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Line, Circle, Rect, Text } from 'react-konva';
import { formatLength } from '../../utils/unitConverter';
import { measureSideLenWidth } from './canvasUtils';

const SIDE_LEN_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const SIDE_LEN_FONT_STYLE = '500';

/* ── Animation helpers ──────────────────────────────────────────────────── */

const ANIM_DURATION_MS = 75;

/** Ease-in-out cubic easing function. */
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Resample a closed polygon to exactly `n` vertices evenly distributed
 * along the perimeter by arc length.
 */
const resamplePolygon = (vertices, n) => {
  if (!vertices || vertices.length === 0 || n <= 0) return [];
  if (vertices.length === n) return vertices;

  const len = vertices.length;
  const cumLen = [0];
  for (let i = 1; i <= len; i++) {
    const a = vertices[i - 1];
    const b = vertices[i % len];
    cumLen.push(cumLen[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const totalLen = cumLen[len];
  if (totalLen === 0) return Array.from({ length: n }, () => ({ ...vertices[0] }));

  const result = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * totalLen;
    while (seg < len - 1 && cumLen[seg + 1] < target) seg++;
    const segLen = cumLen[seg + 1] - cumLen[seg];
    const t = segLen > 0 ? (target - cumLen[seg]) / segLen : 0;
    const a = vertices[seg];
    const b = vertices[(seg + 1) % len];
    result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return result;
};

/**
 * Detect whether a vertex change is a "mode toggle" (many vertices moved at
 * once) rather than a single-vertex drag.
 */
const detectSignificantChange = (prev, next) => {
  if (!prev || !next || prev.length < 3 || next.length < 3) return false;
  if (prev.length !== next.length) return true;
  let movedCount = 0;
  for (let i = 0; i < prev.length; i++) {
    const dx = prev[i].x - next[i].x;
    const dy = prev[i].y - next[i].y;
    if (dx * dx + dy * dy > 1) movedCount++;
    if (movedCount > 1) return true;
  }
  return false;
};

/**
 * Hook that smoothly interpolates polygon vertices when a bulk change is
 * detected (e.g. toggling between interior / exterior boundary mode).
 * Single-vertex drags are applied immediately without animation.
 *
 * Returns { displayVertices, isAnimating }.
 */
const useAnimatedVertices = (targetVertices) => {
  const [animState, setAnimState] = useState({ displayVertices: null, isAnimating: false });
  const prevVerticesRef = useRef(null);
  const currentDisplayRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    // Capture the vertices we are transitioning FROM.  If a previous
    // animation was in-flight, start from its most recent visual position
    // so that rapid toggles don't cause jumps.
    const prev = currentDisplayRef.current || prevVerticesRef.current;
    prevVerticesRef.current = targetVertices;
    currentDisplayRef.current = null;

    // Cancel any running animation.
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Nothing to animate from/to.
    if (!prev || !targetVertices || prev.length < 3 || targetVertices.length < 3) {
      setAnimState({ displayVertices: null, isAnimating: false });
      return;
    }

    // Only animate bulk polygon swaps, not single-vertex drags.
    if (!detectSignificantChange(prev, targetVertices)) {
      setAnimState({ displayVertices: null, isAnimating: false });
      return;
    }

    // Resample both polygons to the same vertex count.
    const count = Math.max(prev.length, targetVertices.length);
    const from = resamplePolygon(prev, count);
    const to = resamplePolygon(targetVertices, count);
    const startTime = performance.now();

    setAnimState({ displayVertices: from, isAnimating: true });

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIM_DURATION_MS, 1);
      const eased = easeInOutCubic(progress);

      if (progress < 1) {
        const interpolated = from.map((f, i) => ({
          x: f.x + (to[i].x - f.x) * eased,
          y: f.y + (to[i].y - f.y) * eased,
        }));
        currentDisplayRef.current = interpolated;
        setAnimState({ displayVertices: interpolated, isAnimating: true });
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // End with exact target vertices.
        currentDisplayRef.current = null;
        setAnimState({ displayVertices: null, isAnimating: false });
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [targetVertices]);

  return animState;
};

const compute_midpoint = (line) => ({
  mx: (line.x1 + line.x2) / 2,
  my: (line.y1 + line.y2) / 2,
});

const compute_perpendicular = (line) => {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-6) {
    return { px: 0, py: -1, ex: 1, ey: 0, length: 0, dx, dy };
  }
  const ex = dx / length;
  const ey = dy / length;
  return { px: -dy / length, py: dx / length, ex, ey, length, dx, dy };
};

const rectFromCenter = (cx, cy, width, height) => ({
  left: cx - width / 2,
  right: cx + width / 2,
  top: cy - height / 2,
  bottom: cy + height / 2,
});

const rectsOverlap = (a, b, padding = 0) => !(
  a.right + padding <= b.left ||
  b.right + padding <= a.left ||
  a.bottom + padding <= b.top ||
  b.bottom + padding <= a.top
);

const pointToRectDistance = (point, rect) => {
  const nearX = Math.max(rect.left, Math.min(point.x, rect.right));
  const nearY = Math.max(rect.top, Math.min(point.y, rect.bottom));
  return Math.hypot(point.x - nearX, point.y - nearY);
};

const pointToSegmentDistance = (point, line) => {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-6) return Math.hypot(point.x - line.x1, point.y - line.y1);
  const t = Math.max(0, Math.min(1, ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / lengthSquared));
  const projX = line.x1 + t * dx;
  const projY = line.y1 + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
};

const generate_label_candidates = (line, zoom, offsetBase) => {
  const { mx, my } = compute_midpoint(line);
  const { px, py, ex, ey } = compute_perpendicular(line);
  const offset = offsetBase / zoom;
  const shifts = [0, -0.18, 0.18, -0.1, 0.1];
  const directions = [1, -1];
  const candidates = [];

  for (const direction of directions) {
    for (const shift of shifts) {
      const along = line.length * shift;
      const cx = mx + ex * along + px * offset * direction;
      const cy = my + ey * along + py * offset * direction;
      candidates.push({ cx, cy, along, direction, offset });
    }
  }
  return candidates;
};

const score_candidate = (candidate, context) => {
  const {
    rect,
    vertices,
    placedLabels,
    edgeLine,
    minVertexClearance,
    minLineGap,
    bounds,
  } = context;

  let minVertexDistance = Infinity;
  for (const v of vertices) {
    minVertexDistance = Math.min(minVertexDistance, pointToRectDistance(v, rect));
  }

  let minLabelDistance = Infinity;
  for (const placed of placedLabels) {
    const dx = candidate.cx - placed.cx;
    const dy = candidate.cy - placed.cy;
    minLabelDistance = Math.min(minLabelDistance, Math.hypot(dx, dy));
    if (rectsOverlap(rect, placed.rect, 1 / context.scale)) return Number.NEGATIVE_INFINITY;
  }
  if (!Number.isFinite(minLabelDistance)) minLabelDistance = minVertexDistance;

  const distanceFromLine = pointToSegmentDistance({ x: candidate.cx, y: candidate.cy }, edgeLine);
  if (distanceFromLine < minLineGap) return Number.NEGATIVE_INFINITY;

  const edgeMargin = Math.min(
    rect.left - bounds.left,
    bounds.right - rect.right,
    rect.top - bounds.top,
    bounds.bottom - rect.bottom
  );

  if (minVertexDistance < minVertexClearance) return Number.NEGATIVE_INFINITY;

  return (
    1.8 * minVertexDistance +
    1.5 * minLabelDistance +
    1.0 * distanceFromLine +
    0.6 * edgeMargin -
    0.5 * Math.abs(candidate.along)
  );
};

const resolve_collisions = (layouts, scale) => {
  const resolved = [];
  for (const layout of layouts) {
    const collides = resolved.some((placed) => rectsOverlap(placed.rect, layout.rect, 1 / scale));
    if (!collides) resolved.push(layout);
  }
  return resolved;
};

const place_label = (line, zoom, existing_labels, context) => {
  const candidates = generate_label_candidates(line, zoom, context.offsetBase);
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const { px, py } = compute_perpendicular(line);

  for (const rawCandidate of candidates) {
    let candidate = { ...rawCandidate };
    let rect = rectFromCenter(candidate.cx, candidate.cy, context.labelWidth, context.labelHeight);

    for (let attempt = 0; attempt < 4; attempt++) {
      let nearestVertexDist = Infinity;
      for (const v of context.vertices) {
        nearestVertexDist = Math.min(nearestVertexDist, pointToRectDistance(v, rect));
      }
      if (nearestVertexDist >= context.minVertexClearance) break;
      candidate = {
        ...candidate,
        cx: candidate.cx + px * context.vertexPushStep,
        cy: candidate.cy + py * context.vertexPushStep,
      };
      rect = rectFromCenter(candidate.cx, candidate.cy, context.labelWidth, context.labelHeight);
    }

    const score = score_candidate(candidate, {
      ...context,
      rect,
      edgeLine: line,
      placedLabels: existing_labels,
    });
    if (score > bestScore) {
      bestScore = score;
      best = { ...candidate, rect, score };
    }
  }

  return best;
};

/**
 * Compute label layout data for every edge of the perimeter polygon.
 * This is extracted into a pure function so it can be memoized via useMemo.
 */
const computeLabelLayouts = (vertices, scale, pixelsPerFoot, detectedDimensions, unit) => {
  const bounds = vertices.reduce((acc, v) => ({
    left: Math.min(acc.left, v.x),
    right: Math.max(acc.right, v.x),
    top: Math.min(acc.top, v.y),
    bottom: Math.max(acc.bottom, v.y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

  const placements = [];

  vertices.forEach((vertex, i) => {
    const nextVertex = vertices[(i + 1) % vertices.length];
    const line = { x1: vertex.x, y1: vertex.y, x2: nextVertex.x, y2: nextVertex.y, id: i };
    const lineMeta = compute_perpendicular(line);
    line.length = lineMeta.length;
    if (line.length <= 1e-6) return;

    const lengthInFeet = line.length * pixelsPerFoot;
    const formattedLength = formatLength(lengthInFeet, unit);

    const ocrRefScreenPx = detectedDimensions && detectedDimensions.length > 0
      ? detectedDimensions.reduce((sum, d) => sum + d.bbox.height, 0) / detectedDimensions.length
      : 14;
    const idealFs = Math.max(14, ocrRefScreenPx) / scale;
    const minFs = 8 / scale;
    const padX = 5 / scale;
    const minW = 30 / scale;
    const maxWByEdge = Math.max(minW, line.length * 0.9);
    const widthForFs = (fs) => measureSideLenWidth(formattedLength, fs) + padX * 2;

    let fontSize = idealFs;
    if (widthForFs(fontSize) > maxWByEdge) {
      let lo = minFs;
      let hi = fontSize;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (lo + hi) / 2;
        if (widthForFs(mid) > maxWByEdge) hi = mid; else lo = mid;
      }
      fontSize = Math.max(minFs, lo);
    }

    const labelWidth = Math.min(Math.max(minW, widthForFs(fontSize)), maxWByEdge);
    const labelHeight = Math.max(fontSize * 1.5, 16 / scale);
    const cornerR = labelHeight / 2;

    const placed = place_label(line, scale, placements, {
      vertices,
      bounds,
      labelWidth,
      labelHeight,
      minVertexClearance: 8 / scale,
      minLineGap: Math.max(6 / scale, labelHeight * 0.35),
      offsetBase: Math.max(22, Math.min(36, 28 + labelHeight * 0.25)),
      vertexPushStep: 5 / scale,
      scale,
    });

    const fallback = compute_midpoint(line);
    const finalCx = placed?.cx ?? fallback.mx;
    const finalCy = placed?.cy ?? (fallback.my - 10 / scale);
    const rect = placed?.rect ?? rectFromCenter(finalCx, finalCy, labelWidth, labelHeight);

    placements.push({
      id: i,
      anchor_line: line.id,
      text: formattedLength,
      formattedLength,
      fontSize,
      labelWidth,
      labelHeight,
      cornerR,
      finalCx,
      finalCy,
      cx: finalCx,
      cy: finalCy,
      rect,
    });
  });

  return resolve_collisions(placements, scale);
};

/**
 * PerimeterLayer renders the perimeter polygon outline, draggable vertices,
 * and optional side-length pill labels.
 */
const PerimeterLayer = ({
  perimeterOverlay,
  scale,
  showSideLengths,
  pixelsPerFoot,
  detectedDimensions,
  unit,
  onVertexDragStart,
  onVertexDrag,
  onVertexDragEnd,
  onDeletePerimeterVertex,
}) => {
  const targetVertices = perimeterOverlay?.vertices;

  // Animate between bulk polygon changes (interior ↔ exterior toggle).
  // Hooks must be called before any early return (rules of hooks).
  const { displayVertices, isAnimating } = useAnimatedVertices(targetVertices);

  // During animation, render the interpolated path; otherwise the target.
  const renderVertices = displayVertices || targetVertices;

  // Memoize label layout so we don't recompute O(n²) collision avoidance
  // on every pan/zoom/render unless the actual data changes.
  // Use renderVertices so labels follow the animation in real time.
  const labelLayouts = useMemo(
    () => (showSideLengths && pixelsPerFoot && renderVertices)
      ? computeLabelLayouts(renderVertices, scale, pixelsPerFoot, detectedDimensions, unit)
      : [],
    [renderVertices, scale, pixelsPerFoot, showSideLengths, detectedDimensions, unit]
  );

  if (!perimeterOverlay || !targetVertices) return null;

  return (
    <>
      {/* Perimeter Outline */}
      {/* listening={false}: the filled polygon must not intercept mouse events so
          that the room overlay Rect below it remains interactable. Double-click
          for vertex insertion is handled at the Stage level via onDblClick. */}
      <Line
        points={renderVertices.flatMap(v => [v.x, v.y])}
        stroke="#BD93F9"
        strokeWidth={2 / scale}
        closed={true}
        fill="rgba(189, 147, 249, 0.15)"
        listening={false}
      />

      {/* Perimeter Vertices – hidden during animation for visual clarity */}
      {!isAnimating && targetVertices.map((vertex, i) => (
        <React.Fragment key={i}>
          <Circle
            x={vertex.x}
            y={vertex.y}
            radius={5 / scale}
            fill="#BD93F9"
            stroke="#fff"
            strokeWidth={1.5 / scale}
            draggable
            onDragStart={() => onVertexDragStart(i)}
            onDragMove={(e) => onVertexDrag(i, e)}
            onDragEnd={(e) => onVertexDragEnd(i, e)}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (onDeletePerimeterVertex) onDeletePerimeterVertex(i);
            }}
          />
        </React.Fragment>
      ))}

      {/* Side Length Labels (memoized layout) */}
      {labelLayouts.map((layout, i) => (
        <React.Fragment key={`label-${i}`}>
          <Rect
            x={layout.finalCx - layout.labelWidth / 2}
            y={layout.finalCy - layout.labelHeight / 2}
            width={layout.labelWidth}
            height={layout.labelHeight}
            fill="rgba(40, 42, 54, 0.92)"
            strokeWidth={0}
            cornerRadius={layout.cornerR}
            listening={false}
          />
          <Text
            x={layout.finalCx - layout.labelWidth / 2}
            y={layout.finalCy - layout.labelHeight / 2}
            width={layout.labelWidth}
            height={layout.labelHeight}
            text={layout.formattedLength}
            fontSize={layout.fontSize}
            fill="#ffffff"
            fontFamily={SIDE_LEN_FONT_FAMILY}
            fontStyle={SIDE_LEN_FONT_STYLE}
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </React.Fragment>
      ))}
    </>
  );
};

export default React.memo(PerimeterLayer);
