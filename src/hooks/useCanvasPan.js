import useAppStore from '../store/appStore';

/**
 * useCanvasPan
 *
 * Encapsulates Konva Stage panning (drag) behaviour and the gate that decides
 * whether panning is currently allowed.
 *
 * @param {object} opts
 * @param {React.RefObject} opts.stageRef
 * @param {React.RefObject} opts.scaleRef
 * @param {React.RefObject} opts.isDraggingRef  - shared with Canvas click-guard
 * @param {React.RefObject} opts.dragStartPosRef - shared with Canvas click-guard
 * @param {React.RefObject} opts.isZoomingRef   - from useCanvasZoom
 * @param {React.RefObject} opts.viewportSyncTokenRef
 * @returns {{ canPanCanvas, handleStageDragStart, handleStageDragEnd }}
 */
export function useCanvasPan({
  stageRef,
  scaleRef,
  isDraggingRef,
  dragStartPosRef,
  isZoomingRef,
  viewportSyncTokenRef,
  isPinchingRef = { current: false },
}) {
  /** Record the canvas-space point under the pointer at the start of a stage drag. */
  const handleStageDragStart = () => {
    const stage = stageRef.current;
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (pos) {
      const stagePos = stage.position();
      const currentScale = scaleRef.current;
      dragStartPosRef.current = {
        x: (pos.x - stagePos.x) / currentScale,
        y: (pos.y - stagePos.y) / currentScale,
      };
    }
  };

  /** Mark that a drag happened so the subsequent click event is suppressed. */
  const handleStageDragEnd = () => {
    if (dragStartPosRef.current) {
      isDraggingRef.current = true;

      // Update store with new position using viewportSyncToken
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
        isDraggingRef.current = false;
        dragStartPosRef.current = null;
      }, 100);
    }
  };

  /**
   * True when the stage should be draggable (i.e. panning is allowed): always,
   * except while a zoom or a pinch is already moving the camera.
   */
  // A pinch is the camera moving under two fingers; Konva's own stage drag
  // would move it a second time from whichever finger it decided was first.
  const canPanCanvas = !isZoomingRef.current && !isPinchingRef.current;

  return { canPanCanvas, handleStageDragStart, handleStageDragEnd };
}
