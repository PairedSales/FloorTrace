import { useState, useRef, useCallback, useEffect } from 'react';
import useAppStore from '../../../store/appStore';
import { getCanvasCoordinates } from '../canvasUtils';
import { hasSelfIntersection } from '../../../utils/geometryValidation';
import { toast } from 'sonner';

export function useToolRouter({
  stageRef,
  contentLayerRef,
  scaleRef,
  image,
  imageObj,
  
  // States & Tool Flags
  eraserToolActive,
  cropToolActive,
  lineToolActive,
  drawAreaActive,
  angleToolActive,
  manualEntryMode,
  traceInteractionMode,
  autoSnapEnabled,

  // Sub-system: Camera
  viewportSyncTokenRef,
  
  // Sub-system: Snapping
  findVertexSnapPoint,
  findVerticalSnap,
  findHorizontalSnap,
  snapRoomOverlayPosition,
  ensureImageSnapAnalyzer,

  // Sub-system: Perimeter Editor
  perimeterOverlay,
  perimeterVertices,
  draggingVertex,
  handleClosePerimeter,
  handleAddPerimeterVertex,
  handleInsertPerimeterVertex,

  // Sub-system: Shape Editor
  customShapes,
  currentCustomShape,
  selectedCustomShapeIndex,
  setSelectedCustomShapeIndex,
  onAddCustomShape,
  onCustomShapeUpdate,

  // Sub-system: Measurement
  measurementLines,
  currentMeasurementLine,
  selectedMeasurementLineIndex,
  setSelectedMeasurementLineIndex,
  onAddMeasurementLine,
  onMeasurementLineUpdate,

  // Sub-system: Eraser & Crop Hooks (directly instantiated in Canvas)
  eraser,
  crop,

  // Callbacks from Zustand/App
  onRoomOverlayUpdate,
  onSaveUndoPoint,
  onCancelUndoSave,
  onMeasurementLinesChange,
  onCustomShapesChange,
  onLineToolToggle,
  onDrawAreaToggle,
  onAngleToolToggle,
  roomDimensions,
  roomOverlay,
  onCanvasClick,
}) {
  const [roomStart, setRoomStart] = useState(null);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [draggingRoomCorner, setDraggingRoomCorner] = useState(null);
  const [draggingAngle, setDraggingAngle] = useState(false);

  const [currentMousePos, setCurrentMousePos] = useState(null);

  // Local drag state to bypass Zustand at 60fps
  const [localRoomOverlay, setLocalRoomOverlay] = useState(null);
  const [localMeasurementLine, setLocalMeasurementLine] = useState(null);

  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef(null);
  const lastRoomDragStartRef = useRef(null);

  const isRightClickDraggingRef = useRef(false);
  const lastRightClickPointerPosRef = useRef({ x: 0, y: 0 });
  const rightClickPannedRef = useRef(false);

  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);

  const getCanvasCoords = useCallback(
    (stage) => getCanvasCoordinates(stage, scaleRef, contentLayerRef),
    [scaleRef, contentLayerRef]
  );

  const activeRoomOverlay = localRoomOverlay || roomOverlay;
  const activeMeasurementLine = localMeasurementLine || currentMeasurementLine;

  // Context Menu: Cancel crop or measurement line drawing on right-click
  const handleStageContextMenu = useCallback((e) => {
    e.evt.preventDefault();
    if (rightClickPannedRef.current) return;

    if (cropToolActive && crop.isCroppingRef.current) {
      crop.resetCropState();
      return;
    }

    if (lineToolActive && currentMeasurementLine && onMeasurementLineUpdate) {
      onMeasurementLineUpdate(null);
    }
  }, [cropToolActive, crop, lineToolActive, currentMeasurementLine, onMeasurementLineUpdate]);

  // Stage Mouse Down
  const handleStageMouseDown = useCallback((e) => {
    // Right click panning
    if (e.evt && e.evt.button === 2) {
      isRightClickDraggingRef.current = true;
      lastRightClickPointerPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      rightClickPannedRef.current = false;
      return;
    }

    // Only handle left mouse button
    if (e.evt && e.evt.button !== 0) return;

    const stage = e.target.getStage();
    if (!stage) return;

    if (eraserToolActive) {
      e.cancelBubble = true;
      e.evt.preventDefault();
      eraser.handleEraserMouseDown(stage);
      return;
    }

    if (cropToolActive) {
      e.cancelBubble = true;
      e.evt.preventDefault();
      crop.handleCropMouseDown(stage);
      return;
    }
  }, [eraserToolActive, cropToolActive, eraser, crop]);

  // Stage Mouse Move
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
          const newX = stage.x() + dx;
          const newY = stage.y() + dy;
          stage.position({ x: newX, y: newY });
          stage.batchDraw();
        }
      }
      
      lastRightClickPointerPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    const stage = e.target.getStage();
    if (!stage) return;
    
    const mousePoint = getCanvasCoords(stage);
    if (!mousePoint) return;

    const needsMousePos = eraserToolActive || 
      (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) || 
      (traceInteractionMode === 'drawing' && perimeterVertices && perimeterVertices.length > 0);

    if (needsMousePos && !draggingVertex && !draggingRoom && !draggingRoomCorner) {
      setCurrentMousePos(mousePoint);
    }

    // Eraser brush dragging
    if (eraserToolActive && eraser.isErasingRef.current) {
      eraser.handleEraserMouseMove(stage, e.evt.shiftKey);
      return;
    }

    // Crop selection rectangle dragging
    if (cropToolActive && crop.isCroppingRef.current) {
      crop.handleCropMouseMove(stage);
      return;
    }

    // Detect if mouse moved enough to trigger a drag rather than a click
    if (dragStartPosRef.current && !isDraggingRef.current) {
      const dx = mousePoint.x - dragStartPosRef.current.x;
      const dy = mousePoint.y - dragStartPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 3) {
        isDraggingRef.current = true;
      }
    }

    // Handle room overlay dragging
    if (draggingRoom && roomStart && activeRoomOverlay) {
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;
      
      const movedOverlay = {
        x1: activeRoomOverlay.x1 + deltaX,
        y1: activeRoomOverlay.y1 + deltaY,
        x2: activeRoomOverlay.x2 + deltaX,
        y2: activeRoomOverlay.y2 + deltaY,
        ...(Array.isArray(activeRoomOverlay.polygon)
          ? { polygon: activeRoomOverlay.polygon.map(p => ({ x: p.x + deltaX, y: p.y + deltaY })) }
          : {}),
        ...(activeRoomOverlay.confidence !== undefined ? { confidence: activeRoomOverlay.confidence } : {}),
      };
      
      const shiftHeld = e.evt.shiftKey;
      const newOverlay = (autoSnapEnabled && !shiftHeld) ? snapRoomOverlayPosition(movedOverlay) : movedOverlay;
      setLocalRoomOverlay(newOverlay);
      setRoomStart(mousePoint);
      return;
    }

    // Handle room corner resizing
    if (draggingRoomCorner && activeRoomOverlay) {
      const newOverlay = { x1: activeRoomOverlay.x1, y1: activeRoomOverlay.y1, x2: activeRoomOverlay.x2, y2: activeRoomOverlay.y2 };
      if (activeRoomOverlay.confidence !== undefined) {
        newOverlay.confidence = activeRoomOverlay.confidence;
      }
      const shiftHeld = e.evt.shiftKey;
      
      if (draggingRoomCorner === 'tl') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, activeRoomOverlay.y2, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, mousePoint.x, activeRoomOverlay.x2) : null;
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, activeRoomOverlay.y2, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, activeRoomOverlay.x1, mousePoint.x) : null;
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, activeRoomOverlay.y1, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, mousePoint.x, activeRoomOverlay.x2) : null;
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, activeRoomOverlay.y1, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, activeRoomOverlay.x1, mousePoint.x) : null;
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      }
      
      setLocalRoomOverlay(newOverlay);
      return;
    }

    // Line tool preview
    if (lineToolActive && currentMeasurementLine && currentMeasurementLine.start) {
      setLocalMeasurementLine({
        start: currentMeasurementLine.start,
        end: mousePoint
      });
    }

    // Custom shape preview mouse pos tracking
    if (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) {
      setCurrentMousePos(mousePoint);
    }
  }, [
    eraserToolActive,
    cropToolActive,
    eraser,
    crop,
    draggingRoom,
    roomStart,
    activeRoomOverlay,
    autoSnapEnabled,
    snapRoomOverlayPosition,
    draggingRoomCorner,
    findVerticalSnap,
    findHorizontalSnap,
    lineToolActive,
    currentMeasurementLine,
    drawAreaActive,
    currentCustomShape,
    perimeterVertices,
    draggingVertex,
    getCanvasCoords,
    stageRef,
  ]);

  // Stage Mouse Up
  const handleStageMouseUp = useCallback(() => {
    // End right-click pan dragging
    if (isRightClickDraggingRef.current) {
      isRightClickDraggingRef.current = false;
      if (rightClickPannedRef.current) {
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
      }
      return;
    }

    // Eraser mouse up
    if (eraser.isErasingRef.current) {
      eraser.handleEraserMouseUp();
      return;
    }

    // Crop mouse up
    if (crop.isCroppingRef.current) {
      crop.handleCropMouseUp(crop.cropSelection);
      return;
    }

    // End room overlay dragging
    if (draggingRoom && localRoomOverlay) {
      onRoomOverlayUpdate?.(localRoomOverlay, false);
      if (lastRoomDragStartRef.current) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== localRoomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== localRoomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== localRoomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== localRoomOverlay.y2;
        
        if (!changed) {
          onCancelUndoSave?.();
        }
      }
      setDraggingRoom(false);
      setRoomStart(null);
      setLocalRoomOverlay(null);
      lastRoomDragStartRef.current = null;
    }

    // End room corner resizing
    if (draggingRoomCorner && localRoomOverlay) {
      onRoomOverlayUpdate?.(localRoomOverlay, false);
      if (lastRoomDragStartRef.current) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== localRoomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== localRoomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== localRoomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== localRoomOverlay.y2;
        
        if (!changed) {
          onCancelUndoSave?.();
        }
      }
      setDraggingRoomCorner(null);
      setLocalRoomOverlay(null);
      lastRoomDragStartRef.current = null;
    }

    if (isDraggingRef.current) {
      setTimeout(() => {
        isDraggingRef.current = false;
        dragStartPosRef.current = null;
      }, 100);
    } else {
      dragStartPosRef.current = null;
    }
  }, [eraser, crop, draggingRoom, localRoomOverlay, draggingRoomCorner, onCancelUndoSave, scaleRef, stageRef, viewportSyncTokenRef, onRoomOverlayUpdate]);

  // Window mouseUp listener (handles commits when mouse is released outside canvas bounds)
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isRightClickDraggingRef.current) {
        isRightClickDraggingRef.current = false;
        if (rightClickPannedRef.current) {
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
        }
      }
      if (eraser.isErasingRef.current) {
        eraser.handleEraserMouseUp();
      }
      if (crop.isCroppingRef.current) {
        crop.handleCropMouseUp(crop.cropSelection);
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [eraser, crop, scaleRef, stageRef, viewportSyncTokenRef]);

  // Stage Clicks
  const handleStageClick = useCallback((e) => {
    if (e.evt.button === 2 || e.evt.button === 3 || e.evt.button === 4) {
      return;
    }

    if (isDraggingRef.current || eraserToolActive || cropToolActive) {
      return;
    }

    const target = e.target;
    if (target?.hasName?.('measurement-line') || target?.hasName?.('custom-shape')) {
      return;
    }

    setSelectedMeasurementLineIndex(null);
    setSelectedCustomShapeIndex(null);
    
    const needsSingleClickHandling = 
      (manualEntryMode && onCanvasClick) ||
      (traceInteractionMode === 'drawing' && !lineToolActive && !drawAreaActive && handleAddPerimeterVertex && perimeterVertices !== null) ||
      (lineToolActive && onMeasurementLineUpdate) ||
      (drawAreaActive && onCustomShapeUpdate);
    
    if (!needsSingleClickHandling) {
      return;
    }
    
    clickCountRef.current += 1;
    
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }
    
    clickTimeoutRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 300);
    
    if (clickCountRef.current >= 2) {
      clickCountRef.current = 0;
      clearTimeout(clickTimeoutRef.current);
      return;
    }
    
    setTimeout(() => {
      if (clickCountRef.current !== 1) return;
      
      const stage = e.target.getStage();
      if (!stage) return;
      
      const clickPoint = getCanvasCoords(stage);
      if (!clickPoint) return;
      
      if (manualEntryMode && onCanvasClick) {
        onCanvasClick(clickPoint);
        return;
      }
      
      if (traceInteractionMode === 'drawing' && !lineToolActive && !drawAreaActive && handleAddPerimeterVertex && perimeterVertices !== null) {
        const targetType = e.target.getType();
        if (targetType === 'Rect' || targetType === 'Circle') {
          return;
        }
        
        const snappedPoint = autoSnapEnabled ? findVertexSnapPoint(clickPoint) : null;
        const finalPoint = snappedPoint || clickPoint;
        
        if (perimeterVertices.length > 2) {
          const firstVertex = perimeterVertices[0];
          const dx = finalPoint.x - firstVertex.x;
          const dy = finalPoint.y - firstVertex.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 10 / scaleRef.current) {
            if (hasSelfIntersection(perimeterVertices, true)) {
              toast.error('Cannot close perimeter: would cause self-intersection.');
              return;
            }
            handleClosePerimeter();
            return;
          }
        }

        if (perimeterVertices.length > 0) {
          const candidate = [...perimeterVertices, finalPoint];
          if (hasSelfIntersection(candidate, false)) {
            toast.error('Cannot add vertex: segment would intersect existing lines.');
            return;
          }
        }

        handleAddPerimeterVertex(finalPoint);
        return;
      }
      
      if (lineToolActive && onMeasurementLineUpdate) {
        const storeCurrentLine = useAppStore.getState().currentMeasurementLine;

        if (!storeCurrentLine) {
          onMeasurementLineUpdate({ start: clickPoint, end: clickPoint });
        } else {
          const newLine = { start: storeCurrentLine.start, end: clickPoint };
          onAddMeasurementLine(newLine);
          onMeasurementLineUpdate(null);
          setLocalMeasurementLine(null);
        }
        return;
      }

      if (drawAreaActive && onCustomShapeUpdate) {
        const storeCustomShape = useAppStore.getState().currentCustomShape;

        if (!storeCustomShape) {
          onCustomShapeUpdate({ vertices: [clickPoint], closed: false });
        } else {
          const firstVertex = storeCustomShape.vertices[0];
          const distance = Math.sqrt(Math.pow(clickPoint.x - firstVertex.x, 2) + Math.pow(clickPoint.y - firstVertex.y, 2));

          if (storeCustomShape.vertices.length > 2 && distance < 10 / scaleRef.current) {
            const finalShape = { ...storeCustomShape, closed: true };
            onAddCustomShape(finalShape);
            onCustomShapeUpdate(null);
          } else {
            const newVertices = [...storeCustomShape.vertices, clickPoint];
            onCustomShapeUpdate({ ...storeCustomShape, vertices: newVertices });
          }
        }
        return;
      }
    }, 50);
  }, [
    manualEntryMode,
    traceInteractionMode,
    lineToolActive,
    drawAreaActive,
    perimeterVertices,
    autoSnapEnabled,
    findVertexSnapPoint,
    handleAddPerimeterVertex,
    handleClosePerimeter,
    onCanvasClick,
    onMeasurementLineUpdate,
    onAddMeasurementLine,
    onCustomShapeUpdate,
    onAddCustomShape,
    setSelectedCustomShapeIndex,
    setSelectedMeasurementLineIndex,
    scaleRef,
    getCanvasCoords,
    eraserToolActive,
    cropToolActive,
    setLocalMeasurementLine,
  ]);

  // Stage Double Clicks
  const handleStageDoubleClick = useCallback((e) => {
    if (e.evt && e.evt.button !== 0) return;

    const storeCurrentLine = useAppStore.getState().currentMeasurementLine;
    if (lineToolActive && storeCurrentLine && storeCurrentLine.start) {
      const stage = e.target.getStage();
      if (!stage) return;
      const finalPoint = getCanvasCoords(stage);
      if (!finalPoint) return;

      const newLine = { start: storeCurrentLine.start, end: finalPoint };
      onAddMeasurementLine(newLine);
      onMeasurementLineUpdate(null);
      setLocalMeasurementLine(null);
      return;
    }

    const storeCustomShape = useAppStore.getState().currentCustomShape;
    if (drawAreaActive && storeCustomShape && !storeCustomShape.closed && storeCustomShape.vertices.length >= 3) {
      const finalShape = { ...storeCustomShape, closed: true };
      onAddCustomShape(finalShape);
      onCustomShapeUpdate(null);
      return;
    }

    if (!perimeterOverlay || drawAreaActive || manualEntryMode || lineToolActive) return;
    
    const targetType = e.target.getType();
    if (targetType === 'Circle') return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const clickPoint = getCanvasCoords(stage);
    if (!clickPoint) return;
    
    handleInsertPerimeterVertex(clickPoint);
  }, [
    lineToolActive,
    drawAreaActive,
    perimeterOverlay,
    manualEntryMode,
    handleInsertPerimeterVertex,
    onAddMeasurementLine,
    onMeasurementLineUpdate,
    onAddCustomShape,
    onCustomShapeUpdate,
    getCanvasCoords,
    setLocalMeasurementLine,
  ]);

  // Keyboard Event Listener
  const handleKeyDown = useCallback((e) => {
    const activeElement = document.activeElement;
    const isTypingIntoField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );

    if (isTypingIntoField) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedMeasurementLineIndex !== null && onMeasurementLinesChange) {
        onMeasurementLinesChange(measurementLines.filter((_, index) => index !== selectedMeasurementLineIndex));
        setSelectedMeasurementLineIndex(null);
        return;
      }

      if (selectedCustomShapeIndex !== null && onCustomShapesChange) {
        onCustomShapesChange(customShapes.filter((_, index) => index !== selectedCustomShapeIndex));
        setSelectedCustomShapeIndex(null);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (eraserToolActive) {
        eraser.cancelErase();
      } else if (cropToolActive) {
        crop.resetCropState();
      } else if (lineToolActive && onLineToolToggle) {
        onLineToolToggle();
      } else if (drawAreaActive && onDrawAreaToggle) {
        onDrawAreaToggle();
      } else if (angleToolActive && onAngleToolToggle) {
        onAngleToolToggle();
      } else if (perimeterVertices !== null) {
        useAppStore.getState().setPerimeterVertices(null);
      }
      return;
    }

    if (e.key === 'Enter') {
      if (perimeterVertices && perimeterVertices.length > 2) {
        if (hasSelfIntersection(perimeterVertices, true)) {
          toast.error('Cannot close perimeter: would cause self-intersection.');
          return;
        }
        handleClosePerimeter();
      } else if (drawAreaActive && currentCustomShape && !currentCustomShape.closed && currentCustomShape.vertices.length >= 2) {
        const finalShape = { ...currentCustomShape, closed: true };
        onAddCustomShape(finalShape);
        onCustomShapeUpdate(null);
      }
    }
  }, [
    eraserToolActive,
    cropToolActive,
    eraser,
    crop,
    lineToolActive,
    onLineToolToggle,
    perimeterVertices,
    handleClosePerimeter,
    drawAreaActive,
    onDrawAreaToggle,
    currentCustomShape,
    onAddCustomShape,
    onCustomShapeUpdate,
    selectedMeasurementLineIndex,
    onMeasurementLinesChange,
    measurementLines,
    selectedCustomShapeIndex,
    onCustomShapesChange,
    customShapes,
    angleToolActive,
    onAngleToolToggle,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleRoomMouseDown = useCallback((e) => {
    if (!roomOverlay) return;
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    onSaveUndoPoint?.();
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    const canvasPos = getCanvasCoords(e.target.getStage());
    if (canvasPos) {
      dragStartPosRef.current = canvasPos;
      setRoomStart(canvasPos);
    }

    if (autoSnapEnabled) {
      ensureImageSnapAnalyzer();
    }
    
    setLocalRoomOverlay(roomOverlay);
    setDraggingRoom(true);
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureImageSnapAnalyzer, onSaveUndoPoint]);

  const handleRoomCornerMouseDown = useCallback((corner, e) => {
    if (!roomOverlay) return;
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    onSaveUndoPoint?.();
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    const canvasPos = getCanvasCoords(e.target.getStage());
    if (canvasPos) {
      dragStartPosRef.current = canvasPos;
    }

    if (autoSnapEnabled) {
      ensureImageSnapAnalyzer();
    }
    
    setLocalRoomOverlay(roomOverlay);
    setDraggingRoomCorner(corner);
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureImageSnapAnalyzer, onSaveUndoPoint]);

  return {
    currentMousePos,
    setCurrentMousePos,
    roomStart,
    draggingRoom,
    draggingRoomCorner,
    draggingAngle,
    setDraggingAngle,
    localRoomOverlay,
    localMeasurementLine,
    activeRoomOverlay,
    activeMeasurementLine,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    handleStageDoubleClick,
    handleStageContextMenu,
    handleRoomMouseDown,
    handleRoomCornerMouseDown,
    rightClickPannedRef,
  };
}
