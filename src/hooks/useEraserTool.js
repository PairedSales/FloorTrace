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
  const eraserPathRef = useRef([]);

  const initialVerticesRef = useRef(null);
  const activeVerticesRef = useRef(null);

  const handleEraserMouseDown = useCallback((stage) => {
    if (!eraserToolActive || !perimeterOverlay?.vertices?.length) return false;

    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isErasingRef.current = true;
    eraserStartPosRef.current = pos;
    eraserLastPosRef.current = pos;
    eraserAxisRef.current = null;
    eraserPathRef.current = [pos];

    initialVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));
    activeVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));

    return true;
  }, [eraserToolActive, perimeterOverlay, getCanvasCoords]);

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

    const next = { x: drawX, y: drawY };
    eraserPathRef.current.push(next);
    eraserLastPosRef.current = next;

    return true;
  }, [getCanvasCoords]);

  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current = null;
    eraserAxisRef.current = null;

    const vertices = initialVerticesRef.current;
    const path = eraserPathRef.current;

    if (vertices && vertices.length > 3 && path && path.length > 0) {
      const radius = eraserBrushSize / 2;
      const candidates = [];

      for (let i = 0; i < vertices.length; i++) {
        let minDistance = Infinity;
        if (path.length === 1) {
          minDistance = Math.hypot(vertices[i].x - path[0].x, vertices[i].y - path[0].y);
        } else {
          for (let j = 0; j < path.length - 1; j++) {
            const dist = distancePointToSegment(vertices[i], path[j], path[j + 1]);
            if (dist < minDistance) {
              minDistance = dist;
            }
          }
        }

        if (minDistance <= radius) {
          candidates.push({ index: i, distance: minDistance });
        }
      }

      if (candidates.length > 0) {
        const maxRemovals = vertices.length - 3;
        if (maxRemovals > 0) {
          candidates.sort((a, b) => a.distance - b.distance);
          const removeSet = new Set(candidates.slice(0, maxRemovals).map((c) => c.index));

          if (removeSet.size > 0) {
            const nextVertices = vertices.filter((_, index) => !removeSet.has(index));
            if (nextVertices.length < vertices.length) {
              onPerimeterUpdate?.(nextVertices, true);
            }
          }
        }
      }
    }

    initialVerticesRef.current = null;
    activeVerticesRef.current = null;
    eraserPathRef.current = [];

    return true;
  }, [eraserBrushSize, onPerimeterUpdate]);

  const cancelErase = useCallback(() => {
    if (!isErasingRef.current) return;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current = null;
    eraserAxisRef.current = null;
    eraserPathRef.current = [];

    initialVerticesRef.current = null;
    activeVerticesRef.current = null;
  }, []);

  return {
    isErasingRef,
    handleEraserMouseDown,
    handleEraserMouseMove,
    handleEraserMouseUp,
    cancelErase,
  };
}
