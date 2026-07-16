import { useState, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { hasSelfIntersection, validateVertexMove } from '../../../utils/geometryValidation';
import { pointToLineDistance } from '../canvasUtils';

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

  const lastDraggedVertexRef = useRef(null);
  const lastDragStartPosRef = useRef(null);

  const activePerimeterOverlay = useMemo(() => {
    return localPerimeterVertices 
      ? { ...perimeterOverlay, vertices: localPerimeterVertices }
      : perimeterOverlay;
  }, [perimeterOverlay, localPerimeterVertices]);

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

    if (hasSelfIntersection(newVertices, true)) {
      toast.error('Invalid edit: perimeter cannot self-intersect. Changes reverted.');
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

  const handleRemovePerimeterVertex = useCallback(() => {
    if (perimeterVertices && perimeterVertices.length > 0) {
      onSaveUndoPoint?.();
      const newVertices = perimeterVertices.slice(0, -1);
      setPerimeterVertices(newVertices);
    }
  }, [perimeterVertices, setPerimeterVertices, onSaveUndoPoint]);

  const handleClosePerimeterShape = useCallback(() => {
    if (perimeterVertices && perimeterVertices.length > 2) {
      // App's onClosePerimeter owns the undo save — saving here too pushed
      // two identical snapshots, making the first Ctrl+Z a no-op.
      onClosePerimeter?.();
    }
  }, [perimeterVertices, onClosePerimeter]);

  const handleInsertPerimeterVertex = useCallback((clickPoint) => {
    if (!perimeterOverlay) return;

    const vertices = perimeterOverlay.vertices;
    let closestEdgeIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      const distance = pointToLineDistance(clickPoint, v1, v2);

      if (distance < minDistance) {
        minDistance = distance;
        closestEdgeIndex = i;
      }
    }

    const snappedPoint = autoSnapEnabled ? findVertexSnapPoint(clickPoint) : null;
    const finalPoint = snappedPoint || clickPoint;

    const newVertices = [...vertices];
    newVertices.splice(closestEdgeIndex + 1, 0, finalPoint);

    if (hasSelfIntersection(newVertices, true)) {
      toast.error('Cannot add vertex: would cause perimeter to self-intersect.');
      return;
    }

    onPerimeterUpdate(newVertices, true);
  }, [perimeterOverlay, autoSnapEnabled, findVertexSnapPoint, onPerimeterUpdate]);

  return {
    draggingVertex,
    draggedVertexCoords,
    localPerimeterVertices,
    setLocalPerimeterVertices,
    activePerimeterOverlay,
    isSelfIntersecting,
    isPreviewInvalid,
    handleVertexDragStart,
    handleVertexDragMove,
    handleVertexDragEnd,
    handleAddPerimeterVertex,
    handleRemovePerimeterVertex,
    handleClosePerimeter: handleClosePerimeterShape,
    handleInsertPerimeterVertex,
  };
}
