import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import useAppStore from '../../../store/appStore';
import { flashAt } from '../../../utils/notify';
import { hasSelfIntersection, findSelfIntersection, validateVertexMove } from '../../../utils/geometryValidation';
import { nearestOutlineEdge } from '../outlineHit';

export function usePerimeterEditor({
  perimeterOverlay,
  perimeterVertices,
  currentMousePos,
  autoSnapEnabled,
  findVertexSnapPoint,
  traceInteractionMode,
  onPerimeterUpdate,
  onSaveUndoPoint,
  onCancelUndoSave,
  setPerimeterVertices,
  onClosePerimeter,
}) {
  const [draggingVertex, setDraggingVertex] = useState(null);
  const [draggedVertexCoords, setDraggedVertexCoords] = useState(null);
  const [localPerimeterVertices, setLocalPerimeterVertices] = useState(null);

  // Click-to-select, so Delete has something to act on. It is an index into one
  // vertex array, so any change of that array's identity — an edit, a delete, a
  // trace switch, a re-trace — makes the held index meaningless.
  const [selectedVertexIndex, setSelectedVertexIndex] = useState(null);
  const vertices = perimeterOverlay?.vertices;
  useEffect(() => {
    setSelectedVertexIndex(null);
  }, [vertices]);

  const lastDraggedVertexRef = useRef(null);
  const lastDragStartPosRef = useRef(null);

  const isSelfIntersecting = useMemo(() => {
    if (draggingVertex !== null && draggedVertexCoords && perimeterOverlay?.vertices) {
      return !validateVertexMove(perimeterOverlay.vertices, draggingVertex, draggedVertexCoords, true);
    }
    return false;
  }, [draggingVertex, draggedVertexCoords, perimeterOverlay]);

  const isPreviewInvalid = useMemo(() => {
    if (traceInteractionMode === 'drawing' && perimeterVertices && perimeterVertices.length > 0 && currentMousePos) {
      const snappedPoint = autoSnapEnabled ? findVertexSnapPoint(currentMousePos) : null;
      const finalHoverPoint = snappedPoint || currentMousePos;
      const candidate = [...perimeterVertices, finalHoverPoint];
      return hasSelfIntersection(candidate, false);
    }
    return false;
  }, [traceInteractionMode, perimeterVertices, currentMousePos, autoSnapEnabled, findVertexSnapPoint]);

  const handleVertexDragStart = useCallback((index) => {
    if (!perimeterOverlay) return;

    onSaveUndoPoint?.();

    lastDraggedVertexRef.current = index;
    lastDragStartPosRef.current = { ...perimeterOverlay.vertices[index] };
    setDraggedVertexCoords(null);
    setDraggingVertex(index);
  }, [perimeterOverlay, onSaveUndoPoint]);

  const handleVertexDragMove = useCallback((index, coords) => {
    setDraggedVertexCoords(coords);
  }, []);

  const handleVertexDragEnd = useCallback((index, e) => {
    const currentVertex = { x: e.target.x(), y: e.target.y() };
    const shiftHeld = e?.evt?.shiftKey ?? false;
    const snappedPoint = (autoSnapEnabled && !shiftHeld)
      ? findVertexSnapPoint(currentVertex)
      : null;

    const finalPoint = snappedPoint || currentVertex;

    const origVertex = lastDragStartPosRef.current;
    if (origVertex && finalPoint.x === origVertex.x && finalPoint.y === origVertex.y) {
      onCancelUndoSave?.();
      setDraggingVertex(null);
      return;
    }

    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = finalPoint;

    const crossing = findSelfIntersection(newVertices, true);
    if (crossing) {
      flashAt('That would make the outline cross itself — the corner was put back', crossing);
      onCancelUndoSave?.();
    } else {
      onPerimeterUpdate(newVertices, false);
    }

    setDraggingVertex(null);
    setDraggedVertexCoords(null);
  }, [perimeterOverlay, autoSnapEnabled, findVertexSnapPoint, onPerimeterUpdate, onCancelUndoSave]);

  const handleAddPerimeterVertex = useCallback((vertex) => {
    onSaveUndoPoint?.();
    const newVertices = [...(perimeterVertices || []), vertex];
    setPerimeterVertices(newVertices);
  }, [perimeterVertices, setPerimeterVertices, onSaveUndoPoint]);

  const handleClosePerimeterShape = useCallback(() => {
    if (perimeterVertices && perimeterVertices.length > 2) {
      // App's onClosePerimeter owns the undo save — saving here too pushed
      // two identical snapshots, making the first Ctrl+Z a no-op.
      onClosePerimeter?.();
    }
  }, [perimeterVertices, onClosePerimeter]);

  // A corner goes into the wall nearest the click, whichever outline that wall
  // belongs to — read off the store, because the outline it lands on need not
  // be the one in hand, and is taken in hand by this.
  const handleInsertPerimeterVertex = useCallback((clickPoint) => {
    const { perimeterTraces, activeTraceId, switchPerimeterTrace } = useAppStore.getState();
    const nearest = nearestOutlineEdge(perimeterTraces, activeTraceId, clickPoint);
    if (!nearest) return;
    const { vertices } = perimeterTraces.find((t) => t.id === nearest.traceId);

    const snappedPoint = autoSnapEnabled ? findVertexSnapPoint(clickPoint) : null;
    const finalPoint = snappedPoint || clickPoint;

    const newVertices = [...vertices];
    newVertices.splice(nearest.edgeIndex + 1, 0, finalPoint);

    const crossing = findSelfIntersection(newVertices, true);
    if (crossing) {
      flashAt('A corner there would make the outline cross itself', crossing);
      return;
    }

    // Before the update, which writes to the outline in hand and saves the
    // undo point with it.
    switchPerimeterTrace(nearest.traceId);
    onPerimeterUpdate(newVertices, true);
  }, [autoSnapEnabled, findVertexSnapPoint, onPerimeterUpdate]);

  return {
    draggingVertex,
    draggedVertexCoords,
    selectedVertexIndex,
    setSelectedVertexIndex,
    localPerimeterVertices,
    setLocalPerimeterVertices,
    isSelfIntersecting,
    isPreviewInvalid,
    handleVertexDragStart,
    handleVertexDragMove,
    handleVertexDragEnd,
    handleAddPerimeterVertex,
    handleClosePerimeter: handleClosePerimeterShape,
    handleInsertPerimeterVertex,
  };
}
