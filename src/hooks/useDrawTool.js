import { useCallback, useRef, useState } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';

// Points closer together than this add nothing but memory — the stroke is
// rasterised and dilated by a brush radius an order of magnitude larger.
const MIN_STEP = 3;

/**
 * Draw mode's input side: accumulate freehand strokes over the image. Each
 * completed stroke is one undo step, because backing out the last stroke is
 * the only correction available while painting.
 */
export function useDrawTool({ drawModeActive, getCanvasCoords }) {
  const isDrawingRef = useRef(false);
  const pathRef = useRef([]);
  const startPosRef = useRef(null);
  const axisRef = useRef(null);
  const [currentStroke, setCurrentStroke] = useState(null);

  const addDrawStroke = useAppStore((s) => s.addDrawStroke);

  const handleDrawMouseDown = useCallback((stage) => {
    if (!drawModeActive) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isDrawingRef.current = true;
    startPosRef.current = pos;
    axisRef.current = null;
    pathRef.current = [pos];
    setCurrentStroke({ points: [pos] });
    return true;
  }, [drawModeActive, getCanvasCoords]);

  // Shift locks the stroke to one axis, same gesture the eraser uses, so a
  // straight exterior wall can be painted straight.
  const handleDrawMouseMove = useCallback((stage, shiftKey) => {
    if (!isDrawingRef.current) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    let x = pos.x;
    let y = pos.y;
    if (shiftKey && startPosRef.current) {
      if (!axisRef.current) {
        const dx = Math.abs(pos.x - startPosRef.current.x);
        const dy = Math.abs(pos.y - startPosRef.current.y);
        if (dx > 5 || dy > 5) axisRef.current = dx >= dy ? 'h' : 'v';
      }
      if (axisRef.current === 'h') y = startPosRef.current.y;
      else if (axisRef.current === 'v') x = startPosRef.current.x;
    } else {
      axisRef.current = null;
    }

    const last = pathRef.current[pathRef.current.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP) return true;

    pathRef.current.push({ x, y });
    setCurrentStroke({ points: pathRef.current.slice() });
    return true;
  }, [getCanvasCoords]);

  const handleDrawMouseUp = useCallback(() => {
    if (!isDrawingRef.current) return false;
    isDrawingRef.current = false;
    startPosRef.current = null;
    axisRef.current = null;

    const points = pathRef.current;
    pathRef.current = [];
    setCurrentStroke(null);

    // A click without a drag is not a stroke; committing it would put an undo
    // point on the stack for nothing.
    if (points.length >= 2) {
      undoManager.save();
      addDrawStroke({ points });
    }
    return true;
  }, [addDrawStroke]);

  const cancelDraw = useCallback(() => {
    if (!isDrawingRef.current) return false;
    isDrawingRef.current = false;
    startPosRef.current = null;
    axisRef.current = null;
    pathRef.current = [];
    setCurrentStroke(null);
    return true;
  }, []);

  return {
    isDrawingRef,
    currentStroke,
    handleDrawMouseDown,
    handleDrawMouseMove,
    handleDrawMouseUp,
    cancelDraw,
  };
}
