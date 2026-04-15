import { useRef, useCallback } from 'react';

/**
 * useEraserTool
 *
 * Owns the complete lifecycle of an eraser stroke session:
 *   1. mousedown  — initialise an offscreen canvas from the current image
 *   2. mousemove  — paint white segments onto the offscreen canvas (live preview)
 *   3. mouseup    — commit the result back to the store via onImageUpdate
 *   4. cancelErase — abort mid-stroke and restore the original Konva image node
 *
 * @param {object}          opts
 * @param {HTMLImageElement|null} opts.imageObj         - current loaded image element
 * @param {boolean}         opts.eraserToolActive       - whether the eraser mode is on
 * @param {number}          opts.eraserBrushSize        - brush diameter in image-space px
 * @param {React.RefObject} opts.stageRef               - ref to the Konva Stage node
 * @param {Function}        opts.onImageUpdate          - callback(dataUrl) to persist edits
 * @param {Function}        opts.getCanvasCoords        - (stage) => {x,y} in image-space
 * @returns {{
 *   eraserCanvasRef,
 *   isErasingRef,
 *   handleEraserMouseDown,
 *   handleEraserMouseMove,
 *   handleEraserMouseUp,
 *   cancelErase,
 * }}
 */
export function useEraserTool({
  imageObj,
  eraserToolActive,
  eraserBrushSize,
  stageRef,
  onImageUpdate,
  getCanvasCoords,
}) {
  const eraserCanvasRef   = useRef(null); // offscreen <canvas> used during a stroke
  const isErasingRef      = useRef(false);
  const eraserStartPosRef = useRef(null); // anchor for Shift-constrained axis
  const eraserLastPosRef  = useRef(null); // previous draw position for interpolation
  const eraserAxisRef     = useRef(null); // 'h' | 'v' | null

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Create an offscreen canvas pre-filled with the current image pixels. */
  const initEraserCanvas = useCallback(() => {
    if (!imageObj) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageObj, 0, 0);
    return canvas;
  }, [imageObj]);

  /** Draw a white line segment between two image-space points. */
  const eraseSegment = useCallback((x0, y0, x1, y1, brushSize) => {
    const canvas = eraserCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = brushSize;
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }, []);

  /** Push the offscreen canvas back to the Konva image node and the store. */
  const commitEraserCanvas = useCallback(() => {
    const canvas = eraserCanvasRef.current;
    if (!canvas || !onImageUpdate) return;
    const dataUrl = canvas.toDataURL('image/png');
    onImageUpdate(dataUrl);
    eraserCanvasRef.current = null;
  }, [onImageUpdate]);

  /** Sync the offscreen canvas to the live Konva Image node for instant preview. */
  const flushToKonva = useCallback(() => {
    if (!stageRef.current || !eraserCanvasRef.current) return;
    const imgNode = stageRef.current.findOne('Image');
    if (imgNode) {
      imgNode.image(eraserCanvasRef.current);
      imgNode.getLayer()?.batchDraw();
    }
  }, [stageRef]);

  // ── Public handlers ────────────────────────────────────────────────────────

  /** Start a new erase session on mousedown. Returns true if consumed. */
  const handleEraserMouseDown = useCallback((stage) => {
    if (!eraserToolActive || !imageObj) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    eraserCanvasRef.current   = initEraserCanvas();
    isErasingRef.current      = true;
    eraserStartPosRef.current = pos;
    eraserLastPosRef.current  = pos;
    eraserAxisRef.current     = null;

    // Paint the very first dot so single-click erases work
    eraseSegment(pos.x, pos.y, pos.x, pos.y, eraserBrushSize);
    flushToKonva();

    return true;
  }, [eraserToolActive, imageObj, eraserBrushSize, initEraserCanvas, eraseSegment, flushToKonva, getCanvasCoords]);

  /** Continue erasing during mouse drag. Returns true if consumed. */
  const handleEraserMouseMove = useCallback((stage, shiftKey) => {
    if (!isErasingRef.current || !eraserCanvasRef.current) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    let drawX = pos.x;
    let drawY = pos.y;

    // Shift constrains strokes to the dominant axis
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
    eraseSegment(prev.x, prev.y, drawX, drawY, eraserBrushSize);
    eraserLastPosRef.current = { x: drawX, y: drawY };

    flushToKonva();
    return true;
  }, [eraserBrushSize, eraseSegment, flushToKonva, getCanvasCoords]);

  /** Commit the erased image on mouseup. Returns true if consumed. */
  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;
    isErasingRef.current      = false;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current  = null;
    eraserAxisRef.current     = null;
    commitEraserCanvas();
    return true;
  }, [commitEraserCanvas]);

  /**
   * Abort a mid-stroke erase (e.g. Escape key).
   * Discards the offscreen canvas and restores the original imageObj on
   * the Konva Image node so the user sees the pre-erase state.
   */
  const cancelErase = useCallback(() => {
    if (!isErasingRef.current) return;
    isErasingRef.current      = false;
    eraserCanvasRef.current   = null;
    eraserStartPosRef.current = null;
    eraserLastPosRef.current  = null;
    eraserAxisRef.current     = null;

    if (stageRef.current && imageObj) {
      const imgNode = stageRef.current.findOne('Image');
      if (imgNode) {
        imgNode.image(imageObj);
        imgNode.getLayer()?.batchDraw();
      }
    }
  }, [stageRef, imageObj]);

  return {
    eraserCanvasRef,
    isErasingRef,
    handleEraserMouseDown,
    handleEraserMouseMove,
    handleEraserMouseUp,
    cancelErase,
  };
}
