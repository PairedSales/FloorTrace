import { useState, useRef, useCallback } from 'react';

/**
 * useCropTool
 *
 * Owns the complete lifecycle of a crop selection:
 *   1. mousedown  — anchor the start corner
 *   2. mousemove  — update the live selection rectangle
 *   3. mouseup    — apply the crop (fill outside with white) and commit via onImageUpdate
 *   4. resetCropState — cancel / idle the tool
 *
 * The crop never changes the image dimensions — it white-fills everything
 * outside the selected rectangle so that overlay coordinates stay valid.
 *
 * @param {object}          opts
 * @param {HTMLImageElement|null} opts.imageObj      - current loaded image element
 * @param {boolean}         opts.cropToolActive      - whether the crop mode is on
 * @param {Function}        opts.onImageUpdate       - callback(dataUrl) to persist edits
 * @param {Function|null}   opts.onCropToolToggle    - deactivates the crop tool after apply
 * @param {Function}        opts.getCanvasCoords     - (stage) => {x,y} in image-space
 * @returns {{
 *   cropSelection,
 *   isCroppingRef,
 *   handleCropMouseDown,
 *   handleCropMouseMove,
 *   handleCropMouseUp,
 *   resetCropState,
 * }}
 */
export function useCropTool({
  imageObj,
  cropToolActive,
  onImageUpdate,
  onCropToolToggle,
  getCanvasCoords,
}) {
  // {x1, y1, x2, y2} in image-space — drives the selection rect in the render tree
  const [cropSelection, setCropSelection] = useState(null);
  const isCroppingRef = useRef(false);
  const cropStartRef  = useRef(null);

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Reset to idle state; clears the visible selection rectangle. */
  const resetCropState = useCallback(() => {
    isCroppingRef.current = false;
    cropStartRef.current  = null;
    setCropSelection(null);
  }, []);

  /** Anchor the selection on mousedown. Returns true if consumed. */
  const handleCropMouseDown = useCallback((stage) => {
    if (!cropToolActive || !imageObj) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isCroppingRef.current = true;
    cropStartRef.current  = pos;
    setCropSelection({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
    return true;
  }, [cropToolActive, imageObj, getCanvasCoords]);

  /** Resize the selection rectangle during drag. Returns true if consumed. */
  const handleCropMouseMove = useCallback((stage) => {
    if (!isCroppingRef.current || !cropStartRef.current) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    setCropSelection({
      x1: cropStartRef.current.x,
      y1: cropStartRef.current.y,
      x2: pos.x,
      y2: pos.y,
    });
    return true;
  }, [getCanvasCoords]);

  /**
   * Apply the crop on mouseup.
   * - Normalises the selection rectangle
   * - Draws the original image clipped to the selection onto a same-size canvas
   * - Fills everything outside white
   * - Commits via onImageUpdate
   * Returns true if consumed.
   */
  const handleCropMouseUp = useCallback((sel) => {
    // Accept the selection as a parameter so callers can pass the latest value
    // directly — avoids stale-closure issues with the cropSelection state.
    const currentSel = sel ?? cropSelection;

    if (!isCroppingRef.current || !cropStartRef.current || !imageObj || !onImageUpdate) {
      resetCropState();
      return false;
    }

    if (!currentSel) { resetCropState(); return false; }

    const cx1 = Math.max(0, Math.min(currentSel.x1, currentSel.x2));
    const cy1 = Math.max(0, Math.min(currentSel.y1, currentSel.y2));
    const cx2 = Math.min(imageObj.width,  Math.max(currentSel.x1, currentSel.x2));
    const cy2 = Math.min(imageObj.height, Math.max(currentSel.y1, currentSel.y2));
    const cw  = cx2 - cx1;
    const ch  = cy2 - cy1;

    resetCropState();

    // Ignore tiny / accidental selections
    if (cw < 10 || ch < 10) return false;

    // Keep full image dimensions; white-fill outside the selection
    const canvas = document.createElement('canvas');
    canvas.width  = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, imageObj.width, imageObj.height);
    ctx.drawImage(imageObj, cx1, cy1, cw, ch, cx1, cy1, cw, ch);

    const dataUrl = canvas.toDataURL('image/png');
    onImageUpdate(dataUrl);

    // Deactivate the crop tool — one crop per activation
    if (onCropToolToggle) onCropToolToggle();
    return true;
  }, [imageObj, cropSelection, onImageUpdate, onCropToolToggle, resetCropState]);

  return {
    cropSelection,
    isCroppingRef,
    handleCropMouseDown,
    handleCropMouseMove,
    handleCropMouseUp,
    resetCropState,
  };
}
