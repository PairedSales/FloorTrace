import { useRef, useCallback } from 'react';
// The same clamped point-to-segment projection this file used to declare
// privately. `canvasUtils` imports only `unitConverter`, so reaching it from a
// hook pulls no konva into the graph.
import { pointToLineDistance } from '../components/canvas/canvasUtils';

// Deletes the *outline's* corners, never a pixel of the plan. It carried the
// name "Erase clutter" for a long time, which is what the image eraser
// (`useImageEraser`) does; this one is gated on its own flag so the two cannot
// both be on, and so this one can be disabled with a reason before a trace
// exists rather than silently returning false.
export function useCornerEraser({
  perimeterOverlay,
  cornerEraserActive,
  eraserBrushSize,
  onPerimeterUpdate,
  getCanvasCoords,
}) {
  const isErasingRef = useRef(false);
  const eraserStartPosRef = useRef(null);
  const eraserAxisRef = useRef(null);
  const eraserPathRef = useRef([]);

  const initialVerticesRef = useRef(null);
  const activeVerticesRef = useRef(null);

  const handleEraserMouseDown = useCallback((stage) => {
    if (!cornerEraserActive || !perimeterOverlay?.vertices?.length) return false;

    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isErasingRef.current = true;
    eraserStartPosRef.current = pos;
    eraserAxisRef.current = null;
    eraserPathRef.current = [pos];

    initialVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));
    activeVerticesRef.current = perimeterOverlay.vertices.map((v) => ({ ...v }));

    return true;
  }, [cornerEraserActive, perimeterOverlay, getCanvasCoords]);

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

    return true;
  }, [getCanvasCoords]);

  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
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
            const dist = pointToLineDistance(vertices[i], path[j], path[j + 1]);
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

  // Same boolean contract as the image eraser's: "there was a stroke to drop",
  // which is what an Escape handler needs to decide between dropping the stroke
  // and leaving the tool.
  const cancelErase = useCallback(() => {
    if (!isErasingRef.current) return false;

    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserAxisRef.current = null;
    eraserPathRef.current = [];

    initialVerticesRef.current = null;
    activeVerticesRef.current = null;
    return true;
  }, []);

  return {
    isErasingRef,
    handleEraserMouseDown,
    handleEraserMouseMove,
    handleEraserMouseUp,
    cancelErase,
  };
}
