import { useState, useRef, useCallback, useEffect } from 'react';
import useAppStore from '../../../store/appStore';
import { getCanvasCoordinates } from '../canvasUtils';
import { shortcutsBlocked } from '../../../utils/keyboardGuard';
import { useScaleLine, useScaleTool } from '../../../hooks/useScaleLine';

// What the pointer does on the plan. The plan is looked at, not drawn on, so
// that is a short list: the right button pans, and — while the scale is being
// set from a known length — a click places an end of that length.
export function useToolRouter({
  stageRef,
  contentLayerRef,
  scaleRef,
  scaleToolActive,
  currentScaleLine,
  // Shared with the camera, which sets it while the stage is being dragged so
  // the click that ends a pan places nothing.
  isDraggingRef,
  viewportSyncTokenRef,
  findVertexSnapPoint,
}) {
  // Local drag state to bypass Zustand at 60fps
  const [localScaleLine, setLocalScaleLine] = useState(null);
  const [selectedScaleLineIndex, setSelectedScaleLineIndex] = useState(null);
  const { removeLine: removeScaleLine } = useScaleLine();
  const { leaveScaleTool } = useScaleTool();

  const isRightClickDraggingRef = useRef(false);
  const lastRightClickPointerPosRef = useRef({ x: 0, y: 0 });
  const rightClickPannedRef = useRef(false);

  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  // The deferred single-click below *places geometry* — a scale line end —
  // 50 ms after the click. Letting it fire after unmount writes to the store
  // on behalf of a canvas that is gone.
  const deferredClickRef = useRef(null);

  const getCanvasCoords = useCallback(
    (stage) => getCanvasCoordinates(stage, scaleRef, contentLayerRef),
    [scaleRef, contentLayerRef]
  );

  // ~12 screen px converted to image px so snap reach feels the same at any zoom.
  const getSnapTolerance = useCallback(
    () => Math.min(40, Math.max(6, 12 / (scaleRef.current || 1))),
    [scaleRef]
  );

  const activeScaleLine = localScaleLine || currentScaleLine;

  const handleStageContextMenu = useCallback((e) => {
    e.evt.preventDefault();
  }, []);

  // Write the camera the right-button pan left behind into the store.
  const commitRightClickPan = useCallback(() => {
    isRightClickDraggingRef.current = false;
    if (!rightClickPannedRef.current) return;
    const stage = stageRef.current;
    if (stage) {
      const token = Math.random();
      if (viewportSyncTokenRef) {
        viewportSyncTokenRef.current = token;
      }
      useAppStore.getState().setViewportTransform(
        scaleRef.current,
        { x: stage.x(), y: stage.y() },
        token
      );
    }
    setTimeout(() => {
      rightClickPannedRef.current = false;
    }, 100);
  }, [scaleRef, stageRef, viewportSyncTokenRef]);

  const handleStageMouseDown = useCallback((e) => {
    if (e.evt && e.evt.button === 2) {
      isRightClickDraggingRef.current = true;
      lastRightClickPointerPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      rightClickPannedRef.current = false;
    }
  }, []);

  const handleStageMouseMove = useCallback((e) => {
    // Right click pan dragging
    if (isRightClickDraggingRef.current) {
      const dx = e.evt.clientX - lastRightClickPointerPosRef.current.x;
      const dy = e.evt.clientY - lastRightClickPointerPosRef.current.y;

      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        rightClickPannedRef.current = true;
      }

      if (rightClickPannedRef.current) {
        const stage = stageRef.current;
        if (stage) {
          stage.position({ x: stage.x() + dx, y: stage.y() + dy });
          stage.batchDraw();
        }
      }

      lastRightClickPointerPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    // The length being drawn follows the cursor from its first end.
    if (scaleToolActive && currentScaleLine?.start) {
      const stage = e.target.getStage();
      const mousePoint = stage ? getCanvasCoords(stage) : null;
      if (mousePoint) setLocalScaleLine({ start: currentScaleLine.start, end: mousePoint });
    }
  }, [scaleToolActive, currentScaleLine, getCanvasCoords, stageRef]);

  const handleStageMouseUp = useCallback(() => {
    if (isRightClickDraggingRef.current) commitRightClickPan();
  }, [commitRightClickPan]);

  // The button can come up outside the canvas.
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isRightClickDraggingRef.current) commitRightClickPan();
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [commitRightClickPan]);

  // One end of the length, snapped to a wall face or corner when there is one
  // near: "click both ends of this wall" wants that, and the snap returns null
  // when it finds nothing, so a printed scale bar degrades to a raw click.
  // Shift places exactly where it was clicked.
  const scalePointAt = useCallback((stage, evt) => {
    const point = getCanvasCoords(stage);
    if (!point) return null;
    const snapped = evt?.shiftKey ? null : findVertexSnapPoint(point, getSnapTolerance());
    return snapped || point;
  }, [getCanvasCoords, findVertexSnapPoint, getSnapTolerance]);

  const commitScaleLine = useCallback((end) => {
    const store = useAppStore.getState();
    store.addScaleLine({
      id: `scale-${Date.now()}`,
      start: store.currentScaleLine.start,
      end,
      feet: null,
    });
    store.setCurrentScaleLine(null);
    setLocalScaleLine(null);
  }, []);

  const handleStageClick = useCallback((e) => {
    // A TouchEvent has no `button`.
    if (e.evt.button != null && e.evt.button !== 0) return;
    if (isDraggingRef.current) return;
    if (e.target?.hasName?.('scale-line')) return;

    setSelectedScaleLineIndex(null);
    if (!scaleToolActive) return;

    clickCountRef.current += 1;
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 300);

    // The second click of a double-click is the double-click handler's.
    if (clickCountRef.current >= 2) {
      clickCountRef.current = 0;
      clearTimeout(clickTimeoutRef.current);
      return;
    }

    if (deferredClickRef.current) clearTimeout(deferredClickRef.current);
    deferredClickRef.current = setTimeout(() => {
      deferredClickRef.current = null;
      if (clickCountRef.current !== 1) return;

      const stage = e.target.getStage();
      const point = stage ? scalePointAt(stage, e.evt) : null;
      if (!point) return;

      const store = useAppStore.getState();
      if (!store.currentScaleLine) {
        store.setCurrentScaleLine({ start: point, end: point });
      } else {
        commitScaleLine(point);
      }
    }, 50);
  }, [scaleToolActive, isDraggingRef, scalePointAt, commitScaleLine]);

  const handleStageDoubleClick = useCallback((e) => {
    if (e.evt && e.evt.button != null && e.evt.button !== 0) return;
    if (!scaleToolActive || !useAppStore.getState().currentScaleLine?.start) return;
    const stage = e.target.getStage();
    const point = stage ? getCanvasCoords(stage) : null;
    if (point) commitScaleLine(point);
  }, [scaleToolActive, getCanvasCoords, commitScaleLine]);

  const handleKeyDown = useCallback((e) => {
    if (shortcutsBlocked(e.target)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Through the same path as the panel's own remove, so the scale is
      // re-resolved from what is left rather than outliving its evidence.
      if (selectedScaleLineIndex !== null) {
        const doomed = useAppStore.getState().scaleLines[selectedScaleLineIndex];
        if (doomed) removeScaleLine(doomed.id);
        setSelectedScaleLineIndex(null);
      }
      return;
    }

    if (e.key === 'Escape') {
      const store = useAppStore.getState();
      if (store.scaleToolActive) {
        leaveScaleTool();
        setLocalScaleLine(null);
      } else if (store.mode === 'manual') {
        // Leaving the room picker. `mode` is the only thing that renders the
        // room sizes as buttons, so nothing else here can put them away.
        store.setMode('normal');
      }
    }
  }, [selectedScaleLineIndex, removeScaleLine, leaveScaleTool]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => () => {
    if (deferredClickRef.current) clearTimeout(deferredClickRef.current);
    if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
  }, []);

  // `selectedScaleLineIndex` is an index into `scaleLines`, resolved against the
  // live store only when Delete is pressed — so any change of that array's
  // identity leaves the held index pointing at a different line.
  const scaleLines = useAppStore((s) => s.scaleLines);
  useEffect(() => {
    setSelectedScaleLineIndex(null);
  }, [scaleLines]);

  // The tool put down by any route takes its preview with it.
  useEffect(() => {
    if (!scaleToolActive) setLocalScaleLine(null);
  }, [scaleToolActive]);

  return {
    activeScaleLine,
    selectedScaleLineIndex,
    setSelectedScaleLineIndex,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    handleStageDoubleClick,
    handleStageContextMenu,
  };
}
