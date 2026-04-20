import { useRef, useCallback } from 'react';

const distancePointToSegment = (point, a, b) => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;

  if (abLenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
};

export function useEraserTool({
  perimeterOverlay,
  eraserToolActive,
  eraserBrushSize,
  onPerimeterUpdate,
  getCanvasCoords,
}) {
  const isErasingRef = useRef(false);
  const eraserStartPosRef = useRef(null);
  const eraserLastPosRef = useRef(null);
  const eraserAxisRef = useRef(null);

  const initialVerticesRef = useRef(null);
  const activeVerticesRef = useRef(null);
  const hasChangesRef = useRef(false);

  const eraseVerticesNearStroke = useCallback((from, to) => {
    const vertices = activeVerticesRef.current;
    if (!vertices || vertices.length <= 3) return;

    const radius = eraserBrushSize / 2;
    const candidates = [];

    for (let i = 0; i < vertices.length; i++) {
      const distance = distancePointToSegment(vertices[i], from, to);
      if (distance <= radius) {
        candidates.push({ index: i, distance });
      }
    }

    if (candidates.length === 0) return;

    const maxRemovals = vertices.length - 3;
    if (maxRemovals <= 0) return;

    candidates.sort((a, b) => a.distance - b.distance);
    const removeSet = new Set(candidates.slice(0, maxRemovals).map((c) => c.index));
    if (removeSet.size === 0) return;

    const nextVertices = vertices.filter((_, index) => !removeSet.has(index));
    if (nextVertices.length === vertices.length) return;

    activeVerticesRef.current = nextVertices;
    hasChangesRef.current = true;
    onPerimeterUpdate?.(nextVertices, false);
  }, [eraserBrushSize, onPerimeterUpdate]);

  const handleEraserMouseDown = useCallback((stage) => {
    if (!eraserToolActive || !perimeterOverlay?.vertices?.length) return false;

    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isErasingRef.current = true;
    eraserStartPosRef.current = pos;
    eraserLastPosRef.current = pos;
    eraserAxisRef.current = null;

    initialVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));
    activeVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));
    hasChangesRef.current = false;

    eraseVerticesNearStroke(pos, pos);
    return true;
  }, [eraserToolActive, perimeterOverlay, getCanvasCoords, eraseVerticesNearStroke]);

  const handleEraserMouseMove = useCallback((stage, shiftKey) => {
    if (!isErasingRef.current || !activeVerticesRef.current) return false;

    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    let drawX = pos.x;
    let drawY = pos.y;

    if (shiftKey && eraserStartPosRef.current) {
      if (!eraserAxisRef.current) {
        const dx = Math.abs(pos.x - eraserStartPosRef.current.x);
        const dy = Math.abs(pos.y - eraserStartPosRef.current.y);
        if (dx > 5 || dy > 5) {
          eraserAxisRef.current = dx >= dy ? 'h' : 'v';
        }
      }

      if (eraserAxisRef.current === 'h') drawY = eraserStartPosRef.current.y;
      else if (eraserAxisRef.current === 'v') drawX = eraserStartPosRef.current.x;
    } else {
      eraserAxisRef.current = null;
    }

    const prev = eraserLastPosRef.current ?? { x: drawX, y: drawY };
    const next = { x: drawX, y: drawY };

    eraseVerticesNearStroke(prev, next);
    eraserLastPosRef.current = next;

    return true;
  }, [getCanvasCoords, eraseVerticesNearStroke]);

  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current = null;
    eraserAxisRef.current = null;

    if (hasChangesRef.current && activeVerticesRef.current) {
      onPerimeterUpdate?.(activeVerticesRef.current, true);
    }

    initialVerticesRef.current = null;
    activeVerticesRef.current = null;
    hasChangesRef.current = false;

    return true;
  }, [onPerimeterUpdate]);

  const cancelErase = useCallback(() => {
    if (!isErasingRef.current) return;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current = null;
    eraserAxisRef.current = null;

    if (initialVerticesRef.current) {
      onPerimeterUpdate?.(initialVerticesRef.current, false);
    }

    initialVerticesRef.current = null;
    activeVerticesRef.current = null;
    hasChangesRef.current = false;
  }, [onPerimeterUpdate]);

  return {
    isErasingRef,
    handleEraserMouseDown,
    handleEraserMouseMove,
    handleEraserMouseUp,
    cancelErase,
  };
}
