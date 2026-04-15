import { useMemo } from 'react';

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
 * @param {boolean}         opts.draggingRoom
 * @param {*}               opts.draggingRoomCorner
 * @param {*}               opts.draggingVertex
 * @param {boolean}         opts.manualEntryMode
 * @param {boolean}         opts.eraserToolActive
 * @param {boolean}         opts.cropToolActive
 * @param {object|null}     opts.roomOverlay
 * @param {object|null}     opts.perimeterOverlay
 * @returns {{ canPanCanvas, handleStageDragStart, handleStageDragEnd }}
 */
export function useCanvasPan({
  stageRef,
  scaleRef,
  isDraggingRef,
  dragStartPosRef,
  isZoomingRef,
  draggingRoom,
  draggingRoomCorner,
  draggingVertex,
  manualEntryMode,
  eraserToolActive,
  cropToolActive,
  roomOverlay,
  perimeterOverlay,
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

      setTimeout(() => {
        isDraggingRef.current = false;
        dragStartPosRef.current = null;
      }, 100);
    }
  };

  /**
   * True when the stage should be draggable (i.e. panning is allowed).
   * Panning is blocked during room/corner/vertex drags, tool modes that need
   * clean pointer events, and while the zoom animation is in flight.
   */
  const canPanCanvas = useMemo(() => {
    if (draggingRoom || draggingRoomCorner || draggingVertex !== null) return false;
    if (manualEntryMode || eraserToolActive || cropToolActive) return false;
    if (roomOverlay && !perimeterOverlay) return false; // vertex placement mode
    return !isZoomingRef.current;
  }, [
    draggingRoom,
    draggingRoomCorner,
    draggingVertex,
    manualEntryMode,
    eraserToolActive,
    cropToolActive,
    roomOverlay,
    perimeterOverlay,
    isZoomingRef,
  ]);

  return { canPanCanvas, handleStageDragStart, handleStageDragEnd };
}
