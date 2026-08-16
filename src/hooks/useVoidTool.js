import { useCallback, useMemo, useRef, useState } from 'react';
import { notify } from '../utils/notify';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { getCentroid, holeRings } from '../utils/areaCalculator';
import { validateHoleRing } from '../utils/geometryValidation';
import { pointInPolygon } from '../utils/detection/polygon.js';

// Image px. Below this a press is a click placing a polygon corner; above it
// the same press is a rectangle drag, so both gestures share one button.
const DRAG_THRESHOLD = 4;

const rectRing = (a, b) => [
  { x: a.x, y: a.y },
  { x: b.x, y: a.y },
  { x: b.x, y: b.y },
  { x: a.x, y: b.y },
];

const isDegenerateRect = (a, b) =>
  Math.abs(b.x - a.x) < DRAG_THRESHOLD || Math.abs(b.y - a.y) < DRAG_THRESHOLD;

/**
 * Draw a void by hand and subtract it from a trace: drag a rectangle, or click
 * corner by corner and close on the first one (or Enter).
 *
 * The candidate is validated on every move rather than only on release, so the
 * rejection is visible in the preview colour before the mouse comes up.
 */
export function useVoidTool({ voidToolActive, getCanvasCoords, scaleRef }) {
  const isVoidingRef = useRef(false);
  const anchorRef = useRef(null);
  const draggedRef = useRef(false);

  const [rect, setRect] = useState(null);
  const [polygon, setPolygon] = useState([]);
  const [previewPoint, setPreviewPoint] = useState(null);

  // Which closed outline this void belongs to. Hit-tested by centroid against
  // every visible trace, preferring the active one — a void outside them all is
  // rejected rather than silently attached to whichever trace is selected.
  const pickTargetTrace = useCallback((ring) => {
    const { perimeterTraces, activeTraceId } = useAppStore.getState();
    const c = getCentroid(ring);
    const holding = (perimeterTraces || []).filter((t) => (
      t.visible && t.closed && t.vertices?.length >= 3 && pointInPolygon(c, t.vertices, [])
    ));
    if (!holding.length) return null;
    return holding.find((t) => t.id === activeTraceId) ?? holding[0];
  }, []);

  const evaluate = useCallback((ring) => {
    if (!ring || ring.length < 3) {
      return { ok: false, reason: 'A void needs at least three corners', trace: null };
    }
    const trace = pickTargetTrace(ring);
    if (!trace) {
      return { ok: false, reason: 'Place the void inside a closed outline', trace: null };
    }
    const existing = holeRings(trace.holes).filter((r) => r?.length >= 3);
    return { ...validateHoleRing(ring, trace.vertices, existing), trace };
  }, [pickTargetTrace]);

  const commit = useCallback((ring) => {
    const { ok, reason, trace } = evaluate(ring);
    if (!ok) {
      notify(reason, { type: 'error', id: 'void-tool' });
      return false;
    }
    undoManager.save();
    useAppStore.getState().addHole(trace.id, ring);
    return true;
  }, [evaluate]);

  const reset = useCallback(() => {
    isVoidingRef.current = false;
    anchorRef.current = null;
    draggedRef.current = false;
    setRect(null);
    setPolygon([]);
    setPreviewPoint(null);
  }, []);

  const handleVoidMouseDown = useCallback((stage) => {
    if (!voidToolActive) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isVoidingRef.current = true;
    anchorRef.current = pos;
    draggedRef.current = false;
    return true;
  }, [voidToolActive, getCanvasCoords]);

  const handleVoidMouseMove = useCallback((stage) => {
    if (!voidToolActive) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    setPreviewPoint(pos);

    // A press that has travelled is a rectangle drag, but only while no polygon
    // is part-placed — otherwise a shaky hand between corners would start one.
    const anchor = anchorRef.current;
    if (isVoidingRef.current && anchor && polygon.length === 0) {
      if (Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > DRAG_THRESHOLD) {
        draggedRef.current = true;
      }
      if (draggedRef.current) setRect({ start: anchor, end: pos });
    }
    return true;
  }, [voidToolActive, getCanvasCoords, polygon.length]);

  const handleVoidMouseUp = useCallback(() => {
    if (!isVoidingRef.current) return false;
    const anchor = anchorRef.current;
    const dragged = draggedRef.current;
    isVoidingRef.current = false;
    anchorRef.current = null;
    draggedRef.current = false;

    if (dragged) {
      const end = rect?.end;
      setRect(null);
      // A flick with no real width is not a rectangle, and rejecting it with a
      // toast would fire on every stray drag.
      if (anchor && end && !isDegenerateRect(anchor, end)) commit(rectRing(anchor, end));
      return true;
    }

    if (!anchor) return true;

    // A click: place a corner, or close on the first one.
    const closeDist = 10 / (scaleRef?.current || 1);
    if (polygon.length > 2 && Math.hypot(anchor.x - polygon[0].x, anchor.y - polygon[0].y) < closeDist) {
      if (commit(polygon)) reset();
      return true;
    }
    setPolygon((prev) => [...prev, anchor]);
    return true;
  }, [rect, polygon, commit, reset, scaleRef]);

  /** Enter: close the polygon in progress. */
  const closeVoidPolygon = useCallback(() => {
    if (polygon.length < 3) return false;
    if (commit(polygon)) reset();
    return true;
  }, [polygon, commit, reset]);

  /** Escape's first stage: drop the shape in progress, keeping the tool on. */
  const cancelVoid = useCallback(() => {
    if (!rect && polygon.length === 0 && !isVoidingRef.current) return false;
    reset();
    return true;
  }, [rect, polygon.length, reset]);

  // The ring as it currently reads, with its verdict, for the preview layer.
  const candidate = useMemo(() => {
    let ring = null;
    let closed = true;
    if (rect) {
      ring = rectRing(rect.start, rect.end);
    } else if (polygon.length) {
      ring = previewPoint ? [...polygon, previewPoint] : polygon;
      closed = false;
    }
    if (!ring) return null;
    const verdict = ring.length >= 3 ? evaluate(ring) : { ok: true, reason: null };
    return { ring, closed, valid: verdict.ok, reason: verdict.reason };
  }, [rect, polygon, previewPoint, evaluate]);

  return {
    isVoidingRef,
    candidate,
    voidPolygon: polygon,
    handleVoidMouseDown,
    handleVoidMouseMove,
    handleVoidMouseUp,
    closeVoidPolygon,
    cancelVoid,
    resetVoidState: reset,
  };
}
