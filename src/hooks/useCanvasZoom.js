import { useRef, useCallback, useEffect } from 'react';
import useAppStore from '../store/appStore';

/**
 * useCanvasZoom
 *
 * Encapsulates mouse-wheel zoom behaviour for a Konva Stage.
 *
 * @param {React.RefObject} stageRef   - ref to the Konva Stage node
 * @param {React.RefObject} scaleRef   - imperative scale ref kept in sync with React state
 * @param {Function}        setScale   - React state setter for scale (kept in sync for renders)
 * @param {React.RefObject} viewportSyncTokenRef - shared ref to ignore redundant store syncs
 * @returns {{ handleWheel, isZoomingRef }}
 */
export function useCanvasZoom(stageRef, scaleRef, setScale, viewportSyncTokenRef) {
  const isZoomingRef = useRef(false);
  const targetPosRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const zoomTimeoutRef = useRef(null);
  const syncTimeoutRef = useRef(null);

  // Clean up animation frame and timeouts on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    e.evt.stopPropagation();

    const stage = stageRef.current;
    if (!stage) return;

    // Initialize targets if not currently zooming
    if (!isZoomingRef.current) {
      isZoomingRef.current = true;
      targetPosRef.current = stage.position();
    }

    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // Reset zooming flag after a short delay
    zoomTimeoutRef.current = setTimeout(() => {
      isZoomingRef.current = false;
    }, 150);

    const oldScale = scaleRef.current;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Point in image-space that the mouse is hovering over,
    // computed relative to the target scale and position.
    const mousePointTo = {
      x: (pointer.x - targetPosRef.current.x) / oldScale,
      y: (pointer.y - targetPosRef.current.y) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.05; // 1.05 for smoother zoom
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(20, newScale));

    // New stage position that keeps the hovered image point stationary
    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    // Update target refs immediately for the next wheel event
    scaleRef.current = clampedScale;
    targetPosRef.current = newPos;

    // Request a single animation frame to apply transforms
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const s = stageRef.current;
        if (!s) return;

        s.scale({ x: scaleRef.current, y: scaleRef.current });
        s.position(targetPosRef.current);
        s.batchDraw();
      });
    }

    // Debounce the React state updates to prevent flickering (tearing between
    // Konva imperative updates and React render cycles). Labels and stroke widths
    // will scale visually with the canvas during the zoom, and snap to their
    // constant pixel size when the user stops scrolling.
    syncTimeoutRef.current = setTimeout(() => {
      const finalScale = scaleRef.current;
      const finalPos = targetPosRef.current;

      setScale(finalScale);
      
      // Generate a new sync token to ignore this change in the canvas sync effect
      const token = Math.random();
      if (viewportSyncTokenRef) {
        viewportSyncTokenRef.current = token;
      }
      
      // Dispatch visual transforms to Zustand store in a single call
      useAppStore.getState().setViewportTransform(finalScale, finalPos, token);
    }, 100);
  }, [stageRef, scaleRef, setScale, viewportSyncTokenRef]);

  return { handleWheel, isZoomingRef };
}
