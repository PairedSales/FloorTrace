import { useRef, useCallback } from 'react';

/**
 * useCanvasZoom
 *
 * Encapsulates mouse-wheel zoom behaviour for a Konva Stage.
 *
 * @param {React.RefObject} stageRef   - ref to the Konva Stage node
 * @param {React.RefObject} scaleRef   - imperative scale ref kept in sync with React state
 * @param {Function}        setScale   - React state setter for scale (kept in sync for renders)
 * @returns {{ handleWheel, isZoomingRef }}
 */
export function useCanvasZoom(stageRef, scaleRef, setScale) {
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef(null);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    e.evt.stopPropagation();

    const stage = stageRef.current;
    if (!stage) return;

    // Mark that we're zooming to prevent drag conflicts
    isZoomingRef.current = true;

    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }

    // Reset zooming flag after a short delay
    zoomTimeoutRef.current = setTimeout(() => {
      isZoomingRef.current = false;
    }, 50);

    const oldScale = scaleRef.current;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const stagePos = stage.position();

    // Point in image-space that the mouse is hovering over
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(20, newScale));

    // New stage position that keeps the hovered image point stationary
    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    // Update imperative ref immediately for the next wheel event
    scaleRef.current = clampedScale;

    requestAnimationFrame(() => {
      stage.setAttrs({
        scaleX: clampedScale,
        scaleY: clampedScale,
        x: newPos.x,
        y: newPos.y,
      });
      // Keep React state in sync so stroke widths, labels, and hit targets match
      setScale(clampedScale);
      stage.batchDraw();
    });
  }, [stageRef, scaleRef, setScale]);

  return { handleWheel, isZoomingRef };
}
