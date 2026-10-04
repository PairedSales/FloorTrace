import { useRef, useCallback } from 'react';
import useAppStore from '../store/appStore';
// `outlineHit` imports only `canvasUtils`, which imports only `unitConverter`,
// so reaching it from a hook pulls no konva into the graph.
import { eraseCornersUnderStroke } from '../components/canvas/outlineHit';

// Deletes the *outline's* corners, never a pixel of the plan. It carried the
// name "Erase clutter" for a long time, which is what the image eraser
// (`useImageEraser`) does; this one is gated on its own flag so the two cannot
// both be on, and so this one can be disabled with a reason before a trace
// exists rather than silently returning false.
//
// The brush works on whichever outline it is run over, not the one in hand:
// the outlines are read off the store when the stroke ends, and the one it
// erased from is taken in hand (`eraseCornersUnderStroke` says which).
export function useCornerEraser({
  cornerEraserActive,
  eraserBrushSize,
  onPerimeterUpdate,
  getCanvasCoords,
}) {
  const isErasingRef = useRef(false);
  const eraserStartPosRef = useRef(null);
  const eraserAxisRef = useRef(null);
  const eraserPathRef = useRef([]);

  const handleEraserMouseDown = useCallback((stage) => {
    if (!cornerEraserActive) return false;

    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isErasingRef.current = true;
    eraserStartPosRef.current = pos;
    eraserAxisRef.current = null;
    eraserPathRef.current = [pos];

    return true;
  }, [cornerEraserActive, getCanvasCoords]);

  const handleEraserMouseMove = useCallback((stage, shiftKey) => {
    if (!isErasingRef.current) return false;

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

    const path = eraserPathRef.current;
    eraserPathRef.current = [];

    const { perimeterTraces, activeTraceId, switchPerimeterTrace } = useAppStore.getState();
    const erased = eraseCornersUnderStroke(perimeterTraces, activeTraceId, path, eraserBrushSize / 2);
    if (erased) {
      // Before the update, which writes to the outline in hand and saves the
      // undo point with it.
      switchPerimeterTrace(erased.traceId);
      onPerimeterUpdate?.(erased.vertices, true);
    }

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
