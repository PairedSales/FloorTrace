import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Line, Circle, Rect, Text, Group } from 'react-konva';
import useAppStore from '../../store/appStore';
import { formatLength, getUnitStyleFromDimensions, formatArea } from '../../utils/unitConverter';
import {
  circleHit, measureSideLenWidth, pointToLineDistance,
  SIDE_LEN_FONT_FAMILY, SIDE_LEN_FONT_STYLE,
} from './canvasUtils';
import { calculateArea, getCentroid, holeRings, holeKey } from '../../utils/areaCalculator';
import { useIsTouch } from '../../hooks/useViewport';

/* ── touch ────────────────────────────────────────────────────────────────
   A vertex handle is 5 px of drawn radius. That is a fine mouse target and an
   impossible finger one — the contact patch is ~9 mm, so on a phone the corner
   the user is trying to nudge is entirely under their own fingertip.

   Two separate numbers, because they answer different questions: the drawn
   radius is "can I see which corner this is" and the hit radius is "can I
   grab it". Inflating the drawn one to 22 px would bury the outline it is
   supposed to annotate under a row of dots. */
const TOUCH_HIT_RADIUS = 22;
const LONG_PRESS_MS = 500;
// A press that wanders this far (screen px) was a drag attempt, not a hold.
const LONG_PRESS_SLOP = 10;

/** Enlarge a circular handle's hit region without touching what is drawn. */

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
  scale,
  showSideLengths,
  feetPerPixel,
  detectedDimensions,
  unit,
  draggingVertex,
  selectedVertexIndex = null,
  onVertexSelect,
  onVertexDragStart,
  onVertexDragMove,
  onVertexDragEnd,
  onDeletePerimeterVertex,
  isSelfIntersecting = false,
  voidToolActive = false,
  voidCandidate = null,
  selectedHole = null,
  onHoleSelect,
}) => {
  const activeTrace = (perimeterTraces || []).find((t) => t.id === activeTraceId);
  const targetVertices = activeTrace?.vertices;

  const isTouch = useIsTouch();
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const strokeColor = isSelfIntersecting ? '#FF5555' : (activeTrace?.color || '#BD93F9');
  const fillColor = hexToRgba(strokeColor, isSelfIntersecting ? 0.08 : 0.12);

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

  // ── long press ───────────────────────────────────────────────────────────
  // Right-click deletes a vertex, and touch has no right-click. A press-and-
  // hold is the touch idiom for "the other action on this thing", so it maps
  // to the same handler. Cancelled by movement (that press was a drag) and by
  // release (that press was a selection), which is what keeps it from firing
  // on the way to nudging a corner.
  const pressRef = useRef(null);

  const cancelLongPress = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const startLongPress = (index, e) => {
    const touch = e.evt?.touches?.[0];
    if (!touch) return;
    cancelLongPress();
    const origin = { x: touch.clientX, y: touch.clientY };
    pressRef.current = {
      origin,
      timer: setTimeout(() => {
        pressRef.current = null;
        // Confirmation is the deletion being undoable and the outline visibly
        // changing; a dialog on a hold gesture teaches the user to fear it.
        navigator.vibrate?.(18);
        onDeletePerimeterVertex?.(index);
      }, LONG_PRESS_MS),
    };
  };

  const moveLongPress = (e) => {
    const press = pressRef.current;
    const touch = e.evt?.touches?.[0];
    if (!press || !touch) return;
    if (Math.hypot(touch.clientX - press.origin.x, touch.clientY - press.origin.y) > LONG_PRESS_SLOP) {
      cancelLongPress();
    }
  };

  useEffect(() => cancelLongPress, []);
  // ── end long press ───────────────────────────────────────────────────────

  const handleDragStart = (index) => {
    cancelLongPress();
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
          // Report the position upward so the self-intersection check can run
          // against it. Inside the rAF, not per mousemove: the parent stores
          // this in state, and the frame is already the update rate for the
          // local vertices below it.
          onVertexDragMove?.(idx, { x, y });
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

  // Enclosed voids (courtyards, light wells, and anything punched by hand) are
  // drawn as dashed inner rings and are already subtracted from the trace's
  // area. Shapes go through the shared `holeRings` normalizer so a tagged hole
  // and a v1 file's bare ring cannot render differently.
  const holeShapes = (perimeterTraces || []).flatMap((trace) => {
    if (!trace.visible) return [];
    const holes = trace.holes ?? [];
    return holeRings(holes).flatMap((ring, i) => {
      if (!ring || ring.length < 3) return [];
      const id = holeKey(holes[i], i);
      const hole = holes[i];
      // A void the outline moved out from under: still drawn, because it is the
      // user's, but in the invalid colour and no longer subtracted, so it can
      // never read as a silently-applied subtraction that is not happening.
      const stale = !!(hole && !Array.isArray(hole) && hole.stale);
      return [{
        key: `hole-${trace.id}-${id}`,
        traceId: trace.id,
        holeId: id,
        ring,
        stale,
        staleReason: stale ? hole.staleReason : null,
        points: ring.flatMap((v) => [v.x, v.y]),
        color: stale ? '#FF5555' : (trace.color || '#BD93F9'),
        selected: selectedHole?.traceId === trace.id && selectedHole?.holeId === id,
      }];
    });
  });

  return (
    <>
      {/* 1. Render all visible inactive traces first */}
      {(perimeterTraces || []).map((trace) => {
        if (!trace.visible || trace.id === activeTraceId) return null;
        const color = trace.color || '#BD93F9';
        const fillRgba = hexToRgba(color, 0.15);
        const strokeRgba = hexToRgba(color, 0.75);

        return (
          <Line
            key={`inactive-outline-${trace.id}`}
            points={trace.vertices ? trace.vertices.flatMap(v => [v.x, v.y]) : []}
            stroke={strokeRgba}
            strokeWidth={2 / scale}
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

      {/* 2b. Render enclosed voids. After the outlines, not before: both fills
              are translucent and covered their own voids, so a subtraction read
              as slightly-darker floor. */}
      {holeShapes.map((hole) => (
        <Line
          key={hole.key}
          name="void-hole"
          points={hole.points}
          stroke={hole.selected ? '#FF79C6' : hole.color}
          strokeWidth={(hole.selected ? 3 : 1.5) / scale}
          dash={[6 / scale, 4 / scale]}
          closed={true}
          fill="rgba(40, 42, 54, 0.55)"
          listening={voidToolActive}
          onClick={voidToolActive ? (e) => {
            e.cancelBubble = true;
            onHoleSelect?.({ traceId: hole.traceId, holeId: hole.holeId });
          } : undefined}
          onTap={voidToolActive ? (e) => {
            e.cancelBubble = true;
            onHoleSelect?.({ traceId: hole.traceId, holeId: hole.holeId });
          } : undefined}
          perfectDrawEnabled={false}
        />
      ))}

      {/* 2c. What each void takes off the total. The badge shows net square
              footage, which on its own never accounts for the difference. */}
      {feetPerPixel && holeShapes.map((hole) => {
        const centroid = getCentroid(hole.ring);
        const holeArea = calculateArea(hole.ring, feetPerPixel);
        if (!(holeArea > 0)) return null;
        const { value: areaText, suffix: areaSuffix } = formatArea(holeArea, unit);
        // A stale void is not subtracted, so it must not claim a minus sign.
        const labelText = hole.stale
          ? `Void outside outline · ${areaText} ${areaSuffix}`
          : `Void −${areaText} ${areaSuffix}`;
        const fontSize = 10 / scale;
        const labelWidth = measureSideLenWidth(labelText, fontSize) + 10 / scale;
        const labelHeight = fontSize * 1.5 + 3 / scale;

        return (
          <Group key={`void-label-${hole.key}`} x={centroid.x} y={centroid.y} listening={false}>
            <Rect
              width={labelWidth}
              height={labelHeight}
              offsetX={labelWidth / 2}
              offsetY={labelHeight / 2}
              rotation={-canvasRotation}
              fill="rgba(40, 42, 54, 0.92)"
              stroke={hole.color}
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

      {/* 2d. The void being drawn, in the invalid colour when the candidate
              already fails validation — so the rejection is visible before the
              mouse comes up. */}
      {voidCandidate?.ring?.length >= 2 && (
        <>
          <Line
            points={voidCandidate.ring.flatMap((v) => [v.x, v.y])}
            stroke={voidCandidate.valid ? '#8BE9FD' : '#FF5555'}
            strokeWidth={2 / scale}
            dash={[6 / scale, 4 / scale]}
            closed={voidCandidate.ring.length >= 3}
            fill={voidCandidate.ring.length >= 3
              ? (voidCandidate.valid ? 'rgba(40, 42, 54, 0.45)' : 'rgba(255, 85, 85, 0.18)')
              : undefined}
            listening={false}
            perfectDrawEnabled={false}
          />
          {!voidCandidate.closed && voidCandidate.ring.map((v, i) => (
            <Circle
              key={`void-corner-${i}`}
              x={v.x}
              y={v.y}
              radius={3.5 / scale}
              fill={voidCandidate.valid ? '#8BE9FD' : '#FF5555'}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
        </>
      )}

      {/* 3. Render active trace draggable vertex handles */}
      {activeTrace && activeTrace.visible && !isAnimating && localVertices && localVertices.map((vertex, i) => (
        <Circle
          key={`active-vertex-${activeTrace.id}-${i}`}
          x={vertex.x}
          y={vertex.y}
          radius={((selectedVertexIndex === i ? 7 : 5) + (isTouch ? 2.5 : 0)) / scale}
          fill={activeTrace.color || '#BD93F9'}
          stroke={selectedVertexIndex === i ? '#8BE9FD' : '#fff'}
          strokeWidth={(selectedVertexIndex === i ? 2.5 : 1.5) / scale}
          draggable
          // The grabbable region, separate from the drawn one. `/scale` keeps
          // it a constant *screen* size, so a corner is no harder to hit when
          // the plan is zoomed out — which is exactly when it is smallest.
          hitFunc={isTouch ? circleHit(TOUCH_HIT_RADIUS / scale) : undefined}
          onClick={(e) => {
            // Konva fires click for every button, and right-click already means
            // delete on this handle.
            if (e.evt && e.evt.button != null && e.evt.button !== 0) return;
            e.cancelBubble = true;
            onVertexSelect?.(i);
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            onVertexSelect?.(i);
          }}
          onDragStart={() => handleDragStart(i)}
          onDragMove={(e) => handleDragMove(i, e)}
          onDragEnd={(e) => handleDragEnd(i, e)}
          // Deliberately allowed to bubble, matching what `mousedown` does on
          // the same handle: the stage still needs the event to start a pinch
          // whose first finger happened to land on a corner.
          onTouchStart={(e) => startLongPress(i, e)}
          onTouchMove={moveLongPress}
          onTouchEnd={cancelLongPress}
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
        const traceArea = calculateArea(vertices, feetPerPixel, trace.holes);
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
