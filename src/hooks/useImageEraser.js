import { useState, useRef, useCallback, useEffect } from 'react';
import useAppStore from '../store/appStore';

/**
 * useImageEraser
 *
 * A white brush over the plan itself: drag across a legend, a title block or a
 * dimension string and it is gone from the pixels the detector reads. This is
 * what the rail's "Erase clutter" button has always claimed to do — the tool
 * that carried the name deleted outline corners and is now `useCornerEraser`.
 * A legend inside the footprint is a documented way to lose a trace
 * (`legendPlan` in the exterior probe) and nothing in the app could take one
 * off the page.
 *
 * Commits through the same canvas → `toDataURL` → `onImageUpdate` path as
 * `useCropTool`, including reading `imageMimeType` off the store rather than
 * defaulting to PNG: the crop and the eraser both re-encode the whole page, and
 * re-encoding a JPEG plan as PNG multiplies the draft and the `.floorplan`.
 * Dimensions never change, so every image-pixel coordinate the app holds —
 * rooms, traces, scale lines, feet-per-pixel — stays valid.
 *
 * Unlike the crop it does *not* deactivate itself on commit. A crop is one
 * decision about the page; clearing clutter is several strokes in a row, and
 * turning the brush off after each one would make the second stroke a click on
 * the rail. That one difference is what makes the accumulator below necessary —
 * see `paintTarget`.
 */
export function useImageEraser({
  imageObj,
  imageEraserActive,
  eraserBrushSize,
  onImageUpdate,
  getCanvasCoords,
}) {
  // The stroke in progress, in image space — rendered as the live white band so
  // the user sees what they are about to remove before it is committed.
  const [eraseStroke, setEraseStroke] = useState(null);
  const isErasingRef = useRef(false);
  const strokeRef = useRef([]);
  const startPosRef = useRef(null);
  const axisRef = useRef(null);
  // { canvas, out } — the page as this tool has painted it, and the data URL it
  // last handed out.
  const workRef = useRef(null);

  // The accumulator is only correct while this tool owns the image, and holding
  // a full-page canvas past that is a plan's worth of bitmap kept for nothing.
  useEffect(() => {
    if (!imageEraserActive) workRef.current = null;
  }, [imageEraserActive]);

  const resetStroke = useCallback(() => {
    isErasingRef.current = false;
    strokeRef.current = [];
    startPosRef.current = null;
    axisRef.current = null;
    setEraseStroke(null);
  }, []);

  const handleEraserMouseDown = useCallback((stage) => {
    if (!imageEraserActive || !imageObj) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isErasingRef.current = true;
    startPosRef.current = pos;
    axisRef.current = null;
    strokeRef.current = [pos];
    setEraseStroke([pos]);
    return true;
  }, [imageEraserActive, imageObj, getCanvasCoords]);

  // Shift locks the stroke to the axis it started along, matching the corner
  // eraser and the draw brush. A legend sits in a rectangle, so a straight
  // swipe is the common gesture, not the rare one.
  const handleEraserMouseMove = useCallback((stage, shiftKey) => {
    if (!isErasingRef.current) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    let x = pos.x;
    let y = pos.y;
    const start = startPosRef.current;

    if (shiftKey && start) {
      if (!axisRef.current) {
        const dx = Math.abs(pos.x - start.x);
        const dy = Math.abs(pos.y - start.y);
        if (dx > 5 || dy > 5) axisRef.current = dx >= dy ? 'h' : 'v';
      }
      if (axisRef.current === 'h') y = start.y;
      else if (axisRef.current === 'v') x = start.x;
    } else {
      axisRef.current = null;
    }

    strokeRef.current = [...strokeRef.current, { x, y }];
    setEraseStroke(strokeRef.current);
    return true;
  }, [getCanvasCoords]);

  // Which canvas this stroke lands on. `imageObj` lags a whole decode behind
  // every commit — the camera only mints the new element on the data URL's
  // `onload` — and this tool, unlike the crop, stays active for the next
  // stroke. Reseeding from `imageObj` there would redraw the *pre-erase* page
  // and silently take back the stroke before it, which is a legend reappearing
  // with nothing on screen to say why. So while the app's image is still the
  // one this tool last handed out, keep painting on the same canvas; anything
  // else — an undo, a crop, another plan — reseeds.
  const paintTarget = useCallback(() => {
    const work = workRef.current;
    if (work && useAppStore.getState().image === work.out) return work.canvas;
    if (!imageObj) return null;

    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    canvas.getContext('2d').drawImage(imageObj, 0, 0);
    return canvas;
  }, [imageObj]);

  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;

    const stroke = strokeRef.current;
    const imageMimeType = useAppStore.getState().imageMimeType;
    resetStroke();

    if (!imageObj || !onImageUpdate || !stroke.length) return false;

    // A stroke that never crossed the page is not an edit, and committing one
    // is not free: `onImageUpdate` re-encodes the whole image, takes an undo
    // snapshot of it and clears the traced boundaries and every measured room.
    // A stray click in the grey margin beside the plan would pay all of that to
    // change no pixel.
    const radius = eraserBrushSize / 2;
    const touchesPage = stroke.some((p) => (
      p.x + radius > 0 && p.x - radius < imageObj.width
      && p.y + radius > 0 && p.y - radius < imageObj.height
    ));
    if (!touchesPage) return false;

    const canvas = paintTarget();
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = eraserBrushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.length === 1) {
      // A tap is a dot. `stroke()` on a zero-length path paints nothing in
      // Chrome even with a round cap, so this is not the same call twice.
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }

    const dataUrl = canvas.toDataURL(imageMimeType);
    workRef.current = { canvas, out: dataUrl };
    onImageUpdate(dataUrl);
    return true;
  }, [imageObj, eraserBrushSize, onImageUpdate, paintTarget, resetStroke]);

  const cancelErase = useCallback(() => {
    // Reports whether there was anything to cancel, so Escape can drop the
    // stroke first and leave the tool on the second press — the two-stage shape
    // draw mode and the void tool already use.
    if (!isErasingRef.current) return false;
    resetStroke();
    return true;
  }, [resetStroke]);

  return {
    eraseStroke,
    isErasingRef,
    handleEraserMouseDown,
    handleEraserMouseMove,
    handleEraserMouseUp,
    cancelErase,
  };
}
