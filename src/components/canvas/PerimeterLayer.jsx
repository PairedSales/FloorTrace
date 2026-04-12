import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Line, Circle, Rect, Text } from 'react-konva';
import { formatLength } from '../../utils/unitConverter';
import { measureSideLenWidth } from './canvasUtils';

const SIDE_LEN_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const SIDE_LEN_FONT_STYLE = '500';

/* ── Animation helpers ──────────────────────────────────────────────────── */

const ANIM_DURATION_MS = 300;

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

/**
 * Compute label layout data for every edge of the perimeter polygon.
 * This is extracted into a pure function so it can be memoized via useMemo.
 */
const computeLabelLayouts = (vertices, scale, pixelsPerFoot, detectedDimensions) => {
  return vertices.map((vertex, i) => {
    const nextVertex = vertices[(i + 1) % vertices.length];

    const dx = nextVertex.x - vertex.x;
    const dy = nextVertex.y - vertex.y;
    const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
    const lengthInFeet = lengthInPixels * pixelsPerFoot;
    const formattedLength = formatLength(lengthInFeet, 'decimal');

    const midX = (vertex.x + nextVertex.x) / 2;
    const midY = (vertex.y + nextVertex.y) / 2;

    const angle = Math.atan2(dy, dx);
    const sideSign = i % 2 === 0 ? 1 : -1;
    const shortEdge = lengthInPixels < 48;
    const offsetDistance = sideSign * (shortEdge ? 12 / scale : 9 / scale);
    const offsetX = Math.sin(angle) * offsetDistance;
    const offsetY = -Math.cos(angle) * offsetDistance;

    const ocrRefScreenPx = detectedDimensions && detectedDimensions.length > 0
      ? detectedDimensions.reduce((sum, d) => sum + d.bbox.height, 0) / detectedDimensions.length
      : 14;
    const idealFs = Math.max(14, ocrRefScreenPx) / scale;
    const minFs = 8 / scale;

    const padX = 5 / scale;
    const minW = 30 / scale;
    const maxWByEdge = Math.max(minW, lengthInPixels * 0.9);
    const widthForFs = (fs) => measureSideLenWidth(formattedLength, fs) + padX * 2;

    let fontSize = idealFs;
    if (widthForFs(fontSize) > maxWByEdge) {
      let lo = minFs, hi = fontSize;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (lo + hi) / 2;
        if (widthForFs(mid) > maxWByEdge) hi = mid; else lo = mid;
      }
      fontSize = Math.max(minFs, lo);
    }

    const labelWidth = Math.min(Math.max(minW, widthForFs(fontSize)), maxWByEdge);
    const labelHeight = Math.max(fontSize * 1.5, 16 / scale);
    const cornerR = labelHeight / 2;

    const cx0 = midX + offsetX;
    const cy0 = midY + offsetY;

    const len = lengthInPixels;
    const ex = len > 0 ? dx / len : 1;
    const ey = len > 0 ? dy / len : 0;
    const halfAlong = (labelWidth * Math.abs(ex) + labelHeight * Math.abs(ey)) / 2;
    const vertexClearance = 8 / scale;
    const maxShift = Math.max(0, len / 2 - halfAlong - vertexClearance);

    let edgeShift = 0;
    for (const v of vertices) {
      const pcx = cx0 + edgeShift * ex;
      const pcy = cy0 + edgeShift * ey;
      const nearX = Math.max(pcx - labelWidth / 2, Math.min(v.x, pcx + labelWidth / 2));
      const nearY = Math.max(pcy - labelHeight / 2, Math.min(v.y, pcy + labelHeight / 2));
      const dist2 = (v.x - nearX) ** 2 + (v.y - nearY) ** 2;
      if (dist2 < vertexClearance * vertexClearance) {
        const projEdge = (v.x - pcx) * ex + (v.y - pcy) * ey;
        const required = halfAlong + vertexClearance - Math.abs(projEdge);
        if (required > 0) {
          const dir = projEdge > 0 ? -1 : 1;
          edgeShift = Math.max(-maxShift, Math.min(maxShift, edgeShift + dir * required));
        }
      }
    }

    return {
      formattedLength,
      fontSize,
      labelWidth,
      labelHeight,
      cornerR,
      finalCx: cx0 + edgeShift * ex,
      finalCy: cy0 + edgeShift * ey,
    };
  });
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
  onVertexDragStart,
  onVertexDrag,
  onVertexDragEnd,
  onDeletePerimeterVertex,
  onDoubleClick,
}) => {
  const targetVertices = perimeterOverlay?.vertices;

  // Animate between bulk polygon changes (interior ↔ exterior toggle).
  // Hooks must be called before any early return (rules of hooks).
  const { displayVertices, isAnimating } = useAnimatedVertices(targetVertices);

  // Memoize label layout so we don't recompute O(n²) collision avoidance
  // on every pan/zoom/render unless the actual data changes.
  // Skip label computation during animation for performance.
  const labelLayouts = useMemo(
    () => (showSideLengths && pixelsPerFoot && targetVertices && !isAnimating)
      ? computeLabelLayouts(targetVertices, scale, pixelsPerFoot, detectedDimensions)
      : [],
    [targetVertices, scale, pixelsPerFoot, showSideLengths, detectedDimensions, isAnimating]
  );

  if (!perimeterOverlay || !targetVertices) return null;

  // During animation, render the interpolated path; otherwise the target.
  const renderVertices = displayVertices || targetVertices;

  return (
    <>
      {/* Perimeter Outline */}
      <Line
        points={renderVertices.flatMap(v => [v.x, v.y])}
        stroke="#BD93F9"
        strokeWidth={2 / scale}
        closed={true}
        fill="rgba(189, 147, 249, 0.15)"
        onDblClick={onDoubleClick}
        onDblTap={onDoubleClick}
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
