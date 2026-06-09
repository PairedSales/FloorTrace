import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Line, Circle, Rect, Text, Group } from 'react-konva';
import useAppStore from '../../store/appStore';
import { formatLength, getUnitStyleFromDimensions, formatArea } from '../../utils/unitConverter';
import { measureSideLenWidth, pointToLineDistance } from './canvasUtils';
import { calculateArea, getCentroid } from '../../utils/areaCalculator';

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
 * once) rather than a single-vertex drag or single vertex add/remove.
 */
const detectSignificantChange = (prev, next) => {
  if (!prev || !next || prev.length < 3 || next.length < 3) return false;
  
  // If the count differs by more than 1, it's a bulk change (e.g. entirely new polygon).
  if (Math.abs(prev.length - next.length) > 1) return true;
  
  // If the count differs by exactly 1, it's a single vertex add/remove.
  // We do NOT want to animate this, because animating causes all nodes to unmount
  // and remount, which produces a noticeable flash.
  if (Math.abs(prev.length - next.length) === 1) return false;

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
const computeLabelLayouts = (vertices, scale, feetPerPixel, detectedDimensions, unit, canvasRotation, draggingVertex) => {
  const unitStyle = getUnitStyleFromDimensions(detectedDimensions, unit);
  const rad = ((canvasRotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  // Compute the polygon winding order using Shoelace formula to establish a stable label sideSign.
  // This replaces array-index parity (i % 2 === 0), preventing label flipping when vertices are added.
  let sum = 0;
  for (let idx = 0; idx < vertices.length; idx++) {
    const v1 = vertices[idx];
    const v2 = vertices[(idx + 1) % vertices.length];
    sum += (v2.x - v1.x) * (v2.y + v1.y);
  }
  const isCCW = vertices.length >= 3 ? sum > 0 : true;
  const sideSign = isCCW ? 1 : -1;

  return vertices.map((vertex, i) => {
    const nextVertex = vertices[(i + 1) % vertices.length];

    const dx = nextVertex.x - vertex.x;
    const dy = nextVertex.y - vertex.y;
    const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
    const dxFeet = dx * feetPerPixel.x;
    const dyFeet = dy * feetPerPixel.y;
    const lengthInFeet = Math.sqrt(dxFeet * dxFeet + dyFeet * dyFeet);
    const formattedLength = formatLength(lengthInFeet, unit, unitStyle);

    const midX = (vertex.x + nextVertex.x) / 2;
    const midY = (vertex.y + nextVertex.y) / 2;

    const angle = Math.atan2(dy, dx);
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

    // Calculate the effective bounding box in layer-space for collision detection.
    // Since the label is kept upright (unrotated) in viewport-space, its projection
    // onto the layer-space axes depends on the layer rotation.
    const effectiveWidth = labelWidth * cos + labelHeight * sin;
    const effectiveHeight = labelWidth * sin + labelHeight * cos;

    const cx0 = midX + offsetX;
    const cy0 = midY + offsetY;

    const len = lengthInPixels;
    const ex = len > 0 ? dx / len : 1;
    const ey = len > 0 ? dy / len : 0;
    const halfAlong = (effectiveWidth * Math.abs(ex) + effectiveHeight * Math.abs(ey)) / 2;
    const vertexClearance = 8 / scale;
    const maxShift = Math.max(0, len / 2 - halfAlong - vertexClearance);

    let edgeShift = 0;
    
    // Lightweight mode: skip collision detection if we are actively dragging any vertex.
    // This keeps the 60fps interaction smooth, and layout snaps to correct position on drag end.
    if (draggingVertex === null || draggingVertex === undefined) {
      // Find candidate vertices to check for collision.
      // We always check the endpoints, and check other vertices only if they are close.
      const maxPerpDistance = Math.abs(offsetDistance) + labelHeight / 2 + vertexClearance;
      const candidateVertices = vertices.filter(v => {
        const isEndpoint = (v.x === vertex.x && v.y === vertex.y) || 
                           (v.x === nextVertex.x && v.y === nextVertex.y);
        if (isEndpoint) return true;
        const dist = pointToLineDistance(v, vertex, nextVertex);
        return dist < (maxPerpDistance + 5 / scale);
      });

      for (const v of candidateVertices) {
        const pcx = cx0 + edgeShift * ex;
        const pcy = cy0 + edgeShift * ey;
        const nearX = Math.max(pcx - effectiveWidth / 2, Math.min(v.x, pcx + effectiveWidth / 2));
        const nearY = Math.max(pcy - effectiveHeight / 2, Math.min(v.y, pcy + effectiveHeight / 2));
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

const hexToRgba = (hex, opacity) => {
  if (!hex) return `rgba(189, 147, 249, ${opacity})`;
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

/**
 * PerimeterLayer renders all visible perimeter traces, draggable vertices for
 * the active trace, and centroid name/area badges.
 */
const PerimeterLayer = ({
  perimeterTraces,
  activeTraceId,
  localPerimeterVertices,
  scale,
  showSideLengths,
  feetPerPixel,
  detectedDimensions,
  unit,
  draggingVertex,
  onVertexDragStart,
  onVertexDragEnd,
  onDeletePerimeterVertex,
  isSelfIntersecting = false,
}) => {
  const activeTrace = (perimeterTraces || []).find((t) => t.id === activeTraceId);
  const targetVertices = activeTrace?.vertices;

  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const strokeColor = isSelfIntersecting ? '#FF5555' : (activeTrace?.color || '#BD93F9');
  const fillColor = hexToRgba(strokeColor, isSelfIntersecting ? 0.08 : 0.12);

  // Dev-only Render metrics
  const renderCountRef = useRef(0);
  if (import.meta.env?.DEV) {
    renderCountRef.current += 1;
    console.log(`[PerimeterLayer] Render count: ${renderCountRef.current}`);
  }

  // Ref tracking drag coordinates, current drag index, and animation frame ID
  const draggingVertexIndexRef = useRef(null);
  const dragCoordsRef = useRef(null);
  const dragRafRef = useRef(null);

  // Local state for dragging vertices of the active trace
  const [localVertices, setLocalVertices] = useState(targetVertices);
  const [prevTargetVertices, setPrevTargetVertices] = useState(targetVertices);

  // Derived state from props synchronization, strictly guarded against active drags
  if (targetVertices !== prevTargetVertices) {
    setPrevTargetVertices(targetVertices);
    if (draggingVertexIndexRef.current === null) {
      setLocalVertices(targetVertices);
    }
  }

  // Cancel any pending RAF on unmount
  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  const handleDragStart = (index) => {
    draggingVertexIndexRef.current = index;
    onVertexDragStart?.(index);
  };

  const handleDragMove = (index, e) => {
    const newX = e.target.x();
    const newY = e.target.y();

    dragCoordsRef.current = { index, x: newX, y: newY };

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        if (dragCoordsRef.current) {
          const { index: idx, x, y } = dragCoordsRef.current;
          setLocalVertices((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            next[idx] = { x, y };
            return next;
          });
        }
      });
    }
  };

  const handleDragEnd = (index, e) => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    draggingVertexIndexRef.current = null;
    dragCoordsRef.current = null;
    onVertexDragEnd?.(index, e);
  };

  // Animate between bulk polygon changes (interior ↔ exterior toggle).
  const { displayVertices, isAnimating } = useAnimatedVertices(targetVertices);

  // During animation, render the interpolated path; otherwise the local/drag state.
  const renderVertices = displayVertices || localVertices;

  // Memoize label layout so we don't recompute O(n²) collision avoidance
  // on every pan/zoom/render unless the actual data changes.
  const labelLayouts = useMemo(
    () => (showSideLengths && feetPerPixel && renderVertices)
      ? computeLabelLayouts(renderVertices, scale, feetPerPixel, detectedDimensions, unit, canvasRotation, draggingVertex)
      : [],
    [renderVertices, scale, feetPerPixel, showSideLengths, detectedDimensions, unit, canvasRotation, draggingVertex]
  );

  return (
    <>
      {/* 1. Render all visible inactive traces first */}
      {(perimeterTraces || []).map((trace) => {
        if (!trace.visible || trace.id === activeTraceId) return null;
        const color = trace.color || '#BD93F9';
        const fillRgba = hexToRgba(color, 0.05);
        const strokeRgba = hexToRgba(color, 0.4);

        return (
          <Line
            key={`inactive-outline-${trace.id}`}
            points={trace.vertices ? trace.vertices.flatMap(v => [v.x, v.y]) : []}
            stroke={strokeRgba}
            strokeWidth={1.5 / scale}
            closed={true}
            fill={fillRgba}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}

      {/* 2. Render active trace outline */}
      {activeTrace && activeTrace.visible && (
        <Line
          key={`active-outline-${activeTrace.id}`}
          points={renderVertices ? renderVertices.flatMap(v => [v.x, v.y]) : []}
          stroke={strokeColor}
          strokeWidth={2 / scale}
          closed={true}
          fill={fillColor}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 3. Render active trace draggable vertex handles */}
      {activeTrace && activeTrace.visible && !isAnimating && localVertices && localVertices.map((vertex, i) => (
        <Circle
          key={`active-vertex-${activeTrace.id}-${i}`}
          x={vertex.x}
          y={vertex.y}
          radius={5 / scale}
          fill={activeTrace.color || '#BD93F9'}
          stroke="#fff"
          strokeWidth={1.5 / scale}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragMove={(e) => handleDragMove(i, e)}
          onDragEnd={(e) => handleDragEnd(i, e)}
          onContextMenu={(e) => {
            e.evt.preventDefault();
            e.cancelBubble = true;
            if (onDeletePerimeterVertex) onDeletePerimeterVertex(i);
          }}
        />
      ))}

      {/* 4. Render active trace side length labels */}
      {activeTrace && activeTrace.visible && labelLayouts.map((layout, i) => (
        <React.Fragment key={`active-label-${activeTrace.id}-${i}`}>
          <Rect
            x={layout.finalCx}
            y={layout.finalCy}
            width={layout.labelWidth}
            height={layout.labelHeight}
            offsetX={layout.labelWidth / 2}
            offsetY={layout.labelHeight / 2}
            rotation={-canvasRotation}
            fill="rgba(40, 42, 54, 0.92)"
            strokeWidth={0}
            cornerRadius={layout.cornerR}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={layout.finalCx}
            y={layout.finalCy}
            width={layout.labelWidth}
            height={layout.labelHeight}
            offsetX={layout.labelWidth / 2}
            offsetY={layout.labelHeight / 2}
            rotation={-canvasRotation}
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

      {/* 5. Render Centroid Area Badges for all visible closed traces (only if multiple are active/visible) */}
      {feetPerPixel && (perimeterTraces || []).filter(t => t.visible && t.closed && t.vertices && t.vertices.length >= 3).length > 1 && (perimeterTraces || []).map((trace) => {
        if (!trace.visible || !trace.closed || !trace.vertices || trace.vertices.length < 3) return null;

        // Use renderVertices for active trace to move badge in real time during drag/animation
        const vertices = trace.id === activeTraceId ? renderVertices : trace.vertices;
        if (!vertices || vertices.length < 3) return null;

        const centroid = getCentroid(vertices);
        const traceArea = calculateArea(vertices, feetPerPixel);
        const { value: areaText, suffix: areaSuffix } = formatArea(traceArea, unit);

        const labelText = `${trace.name}: ${areaText} ${areaSuffix}`;
        const fontSize = 11 / scale;
        const labelWidth = measureSideLenWidth(labelText, fontSize) + 12 / scale;
        const labelHeight = fontSize * 1.5 + 4 / scale;

        return (
          <Group
            key={`centroid-badge-${trace.id}`}
            x={centroid.x}
            y={centroid.y}
            listening={false}
          >
            <Rect
              width={labelWidth}
              height={labelHeight}
              offsetX={labelWidth / 2}
              offsetY={labelHeight / 2}
              rotation={-canvasRotation}
              fill="rgba(40, 42, 54, 0.92)"
              stroke={trace.color || '#BD93F9'}
              strokeWidth={1 / scale}
              cornerRadius={labelHeight / 2}
              perfectDrawEnabled={false}
            />
            <Text
              width={labelWidth}
              height={labelHeight}
              offsetX={labelWidth / 2}
              offsetY={labelHeight / 2}
              rotation={-canvasRotation}
              text={labelText}
              fontSize={fontSize}
              fill="#ffffff"
              fontFamily={SIDE_LEN_FONT_FAMILY}
              fontStyle="600"
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}
    </>
  );
};

export default React.memo(PerimeterLayer);
