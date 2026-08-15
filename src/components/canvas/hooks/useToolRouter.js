import { useState, useRef, useCallback, useEffect } from 'react';
import useAppStore from '../../../store/appStore';
import { getCanvasCoordinates } from '../canvasUtils';
import { hasSelfIntersection } from '../../../utils/geometryValidation';
import { shortcutsBlocked } from '../../../utils/keyboardGuard';
import { useScaleLine } from '../../../hooks/useScaleLine';
import { toast } from 'sonner';

export function useToolRouter({
  stageRef,
  contentLayerRef,
  scaleRef,

  // States & Tool Flags
  eraserToolActive,
  cropToolActive,
  lineToolActive,
  drawAreaActive,
  angleToolActive,
  drawModeActive,
  scaleToolActive,
  manualEntryMode,
  traceInteractionMode,
  autoSnapEnabled,

  // Sub-system: Camera
  viewportSyncTokenRef,
  
  // Sub-system: Snapping
  findVertexSnapPoint,
  snapRoomOverlayMove,
  snapRoomOverlayResize,
  ensureWallSnapEngine,

  // Sub-system: Perimeter Editor
  perimeterOverlay,
  perimeterVertices,
  draggingVertex,
  selectedVertexIndex,
  setSelectedVertexIndex,
  onDeletePerimeterVertex,
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

  // Sub-system: Scale line
  currentScaleLine,

  // Sub-system: Eraser, Crop & Draw Hooks (directly instantiated in Canvas)
  eraser,
  crop,
  drawTool,
  onFinishDrawMode,
  onDrawModeToggle,

  // ── void tool ────────────────────────────────────────────────────────────
  voidToolActive,
  voidTool,
  onVoidToolToggle,
  // ── end void tool ────────────────────────────────────────────────────────

  // Callbacks from Zustand/App
  onRoomOverlayUpdate,
  onSaveUndoPoint,
  onCancelUndoSave,
  onMeasurementLinesChange,
  onCustomShapesChange,
  onLineToolToggle,
  onDrawAreaToggle,
  onAngleToolToggle,
  roomOverlay,
  onCanvasClick,
}) {
  const [roomStart, setRoomStart] = useState(null);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [draggingRoomCorner, setDraggingRoomCorner] = useState(null);
  const [draggingAngle, setDraggingAngle] = useState(false);

  const [currentMousePos, setCurrentMousePos] = useState(null);

  // ── void tool ──────────────────────────────────────────────────────────────
  // { traceId, holeId } of the void ring under the cursor's last click.
  const [selectedHole, setSelectedHole] = useState(null);
  // ── end void tool ──────────────────────────────────────────────────────────

  // Local drag state to bypass Zustand at 60fps
  const [localRoomOverlay, setLocalRoomOverlay] = useState(null);
  const [localMeasurementLine, setLocalMeasurementLine] = useState(null);
  const [localScaleLine, setLocalScaleLine] = useState(null);
  const [selectedScaleLineIndex, setSelectedScaleLineIndex] = useState(null);
  const { removeLine: removeScaleLine } = useScaleLine();

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

  // ~12 screen px converted to image px so snap reach feels the same at any zoom.
  const getSnapTolerance = useCallback(
    () => Math.min(40, Math.max(6, 12 / (scaleRef.current || 1))),
    [scaleRef]
  );

  const activeRoomOverlay = localRoomOverlay || roomOverlay;
  const activeMeasurementLine = localMeasurementLine || currentMeasurementLine;
  const activeScaleLine = localScaleLine || currentScaleLine;

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

    if (drawModeActive) {
      e.cancelBubble = true;
      e.evt.preventDefault();
      drawTool.handleDrawMouseDown(stage);
      return;
    }

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

    // ── void tool ────────────────────────────────────────────────────────────
    if (voidToolActive) {
      e.evt.preventDefault();
      voidTool.handleVoidMouseDown(stage);
      return;
    }
    // ── end void tool ────────────────────────────────────────────────────────
  }, [drawModeActive, drawTool, eraserToolActive, cropToolActive, eraser, crop,
    voidToolActive, voidTool]);

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

    const needsMousePos = eraserToolActive || drawModeActive ||
      (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) ||
      (traceInteractionMode === 'drawing' && perimeterVertices && perimeterVertices.length > 0);

    if (needsMousePos && !draggingVertex && !draggingRoom && !draggingRoomCorner) {
      setCurrentMousePos(mousePoint);
    }

    // Draw mode brush painting
    if (drawModeActive && drawTool.isDrawingRef.current) {
      drawTool.handleDrawMouseMove(stage, e.evt.shiftKey);
      return;
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

    // ── void tool ────────────────────────────────────────────────────────────
    // Unconditional while the tool is on: the rubber band between placed
    // corners has to follow the cursor with no button held.
    if (voidToolActive) {
      voidTool.handleVoidMouseMove(stage);
      return;
    }
    // ── end void tool ────────────────────────────────────────────────────────

    // Detect if mouse moved enough to trigger a drag rather than a click
    if (dragStartPosRef.current && !isDraggingRef.current) {
      const dx = mousePoint.x - dragStartPosRef.current.x;
      const dy = mousePoint.y - dragStartPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 3) {
        isDraggingRef.current = true;
      }
    }

    // Handle room overlay dragging. Raw position always derives from the
    // drag-origin overlay plus the cumulative mouse delta, so snap offsets
    // never accumulate frame-to-frame and the cursor can always pull the
    // overlay off a wall.
    if (draggingRoom && roomStart && lastRoomDragStartRef.current) {
      const origin = lastRoomDragStartRef.current;
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;

      const movedOverlay = {
        x1: origin.x1 + deltaX,
        y1: origin.y1 + deltaY,
        x2: origin.x2 + deltaX,
        y2: origin.y2 + deltaY,
        ...(Array.isArray(origin.polygon)
          ? { polygon: origin.polygon.map(p => ({ x: p.x + deltaX, y: p.y + deltaY })) }
          : {}),
        ...(origin.confidence !== undefined ? { confidence: origin.confidence } : {}),
      };

      const shiftHeld = e.evt.shiftKey;
      const newOverlay = (autoSnapEnabled && !shiftHeld)
        ? snapRoomOverlayMove(movedOverlay, getSnapTolerance())
        : movedOverlay;
      setLocalRoomOverlay(newOverlay);
      return;
    }

    // Handle room corner resizing
    if (draggingRoomCorner && lastRoomDragStartRef.current) {
      const origin = lastRoomDragStartRef.current;
      const rawOverlay = { x1: origin.x1, y1: origin.y1, x2: origin.x2, y2: origin.y2 };
      if (draggingRoomCorner === 'tl') {
        rawOverlay.x1 = mousePoint.x;
        rawOverlay.y1 = mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        rawOverlay.x2 = mousePoint.x;
        rawOverlay.y1 = mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        rawOverlay.x1 = mousePoint.x;
        rawOverlay.y2 = mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        rawOverlay.x2 = mousePoint.x;
        rawOverlay.y2 = mousePoint.y;
      }

      const shiftHeld = e.evt.shiftKey;
      const newOverlay = (autoSnapEnabled && !shiftHeld)
        ? snapRoomOverlayResize(draggingRoomCorner, rawOverlay, getSnapTolerance())
        : rawOverlay;
      if (origin.confidence !== undefined) {
        newOverlay.confidence = origin.confidence;
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

    // ── scale line preview ──────────────────────────────────────────────────
    if (scaleToolActive && currentScaleLine && currentScaleLine.start) {
      setLocalScaleLine({
        start: currentScaleLine.start,
        end: mousePoint
      });
    }
    // ── end scale line preview ──────────────────────────────────────────────

    // Custom shape preview mouse pos tracking
    if (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) {
      setCurrentMousePos(mousePoint);
    }
  }, [
    eraserToolActive,
    cropToolActive,
    drawModeActive,
    drawTool,
    eraser,
    crop,
    draggingRoom,
    roomStart,
    autoSnapEnabled,
    snapRoomOverlayMove,
    snapRoomOverlayResize,
    getSnapTolerance,
    draggingRoomCorner,
    lineToolActive,
    currentMeasurementLine,
    scaleToolActive,
    currentScaleLine,
    drawAreaActive,
    currentCustomShape,
    perimeterVertices,
    draggingVertex,
    getCanvasCoords,
    stageRef,
    voidToolActive,
    voidTool,
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

    // Draw mode mouse up
    if (drawTool.isDrawingRef.current) {
      drawTool.handleDrawMouseUp();
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

    // ── void tool ────────────────────────────────────────────────────────────
    // Both gestures land here: a press that travelled commits a rectangle, a
    // press that did not places the next polygon corner.
    if (voidTool.isVoidingRef.current) {
      voidTool.handleVoidMouseUp();
      return;
    }
    // ── end void tool ────────────────────────────────────────────────────────

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
  }, [drawTool, eraser, crop, voidTool, draggingRoom, localRoomOverlay, draggingRoomCorner, onCancelUndoSave, scaleRef, stageRef, viewportSyncTokenRef, onRoomOverlayUpdate]);

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
      if (drawTool.isDrawingRef.current) {
        drawTool.handleDrawMouseUp();
      }
      if (eraser.isErasingRef.current) {
        eraser.handleEraserMouseUp();
      }
      if (crop.isCroppingRef.current) {
        crop.handleCropMouseUp(crop.cropSelection);
      }
      // ── void tool ──────────────────────────────────────────────────────────
      if (voidTool.isVoidingRef.current) {
        voidTool.handleVoidMouseUp();
      }
      // ── end void tool ──────────────────────────────────────────────────────
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [drawTool, eraser, crop, voidTool, scaleRef, stageRef, viewportSyncTokenRef]);

  // Stage Clicks
  const handleStageClick = useCallback((e) => {
    if (e.evt.button === 2 || e.evt.button === 3 || e.evt.button === 4) {
      return;
    }

    if (isDraggingRef.current || eraserToolActive || cropToolActive || drawModeActive) {
      return;
    }

    const target = e.target;
    if (target?.hasName?.('measurement-line') || target?.hasName?.('custom-shape')
      || target?.hasName?.('scale-line') || target?.hasName?.('void-hole')) {
      return;
    }

    setSelectedMeasurementLineIndex(null);
    setSelectedCustomShapeIndex(null);
    setSelectedScaleLineIndex(null);
    setSelectedHole(null); // void tool
    // Parity with the selections above. Safe without a `hasName` guard: the
    // vertex handle sets `cancelBubble` in its own onClick, so selecting one
    // never reaches this handler — only a click on empty canvas does.
    setSelectedVertexIndex?.(null);
    
    const needsSingleClickHandling = 
      (manualEntryMode && onCanvasClick) ||
      (traceInteractionMode === 'drawing' && !lineToolActive && !drawAreaActive && handleAddPerimeterVertex && perimeterVertices !== null) ||
      (lineToolActive && onMeasurementLineUpdate) ||
      scaleToolActive ||
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

      // ── scale line placement ────────────────────────────────────────────
      // Ahead of perimeter vertex placement: an explicitly activated tool
      // beats a mode that was merely left on. Corner snapping is what "click
      // both ends of this wall" wants, and it returns null when it finds
      // nothing, so a printed scale bar degrades to a raw click.
      if (scaleToolActive) {
        const snapped = (autoSnapEnabled && !e.evt?.shiftKey)
          ? findVertexSnapPoint(clickPoint) : null;
        const finalPoint = snapped || clickPoint;
        const store = useAppStore.getState();
        if (!store.currentScaleLine) {
          store.setCurrentScaleLine({ start: finalPoint, end: finalPoint });
        } else {
          store.addScaleLine({
            id: `scale-${Date.now()}`,
            start: store.currentScaleLine.start,
            end: finalPoint,
            feet: null,
          });
          store.setCurrentScaleLine(null);
          setLocalScaleLine(null);
        }
        return;
      }
      // ── end scale line placement ────────────────────────────────────────
      
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
    setSelectedVertexIndex,
    scaleRef,
    getCanvasCoords,
    eraserToolActive,
    cropToolActive,
    drawModeActive,
    scaleToolActive,
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

    // ── scale line commit ─────────────────────────────────────────────────
    const storeCurrentScaleLine = useAppStore.getState().currentScaleLine;
    if (scaleToolActive && storeCurrentScaleLine && storeCurrentScaleLine.start) {
      const stage = e.target.getStage();
      if (!stage) return;
      const finalPoint = getCanvasCoords(stage);
      if (!finalPoint) return;

      const store = useAppStore.getState();
      store.addScaleLine({
        id: `scale-${Date.now()}`,
        start: storeCurrentScaleLine.start,
        end: finalPoint,
        feet: null,
      });
      store.setCurrentScaleLine(null);
      setLocalScaleLine(null);
      return;
    }
    // ── end scale line commit ─────────────────────────────────────────────

    const storeCustomShape = useAppStore.getState().currentCustomShape;
    if (drawAreaActive && storeCustomShape && !storeCustomShape.closed && storeCustomShape.vertices.length >= 3) {
      const finalShape = { ...storeCustomShape, closed: true };
      onAddCustomShape(finalShape);
      onCustomShapeUpdate(null);
      return;
    }

    if (!perimeterOverlay || drawAreaActive || manualEntryMode || lineToolActive
      || drawModeActive || scaleToolActive) return;
    
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
    drawModeActive,
    perimeterOverlay,
    manualEntryMode,
    handleInsertPerimeterVertex,
    onAddMeasurementLine,
    onMeasurementLineUpdate,
    onAddCustomShape,
    onCustomShapeUpdate,
    getCanvasCoords,
    scaleToolActive,
    setLocalMeasurementLine,
  ]);

  // Keyboard Event Listener
  const handleKeyDown = useCallback((e) => {
    if (shortcutsBlocked(e.target)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // ── Delete targets, in priority order ──────────────────────────────────
      // A live line/shape selection must not be shadowed by a stale vertex
      // selection, so the vertex case comes last.
      if (selectedMeasurementLineIndex !== null && onMeasurementLinesChange) {
        onMeasurementLinesChange(measurementLines.filter((_, index) => index !== selectedMeasurementLineIndex));
        setSelectedMeasurementLineIndex(null);
        return;
      }

      // ── scale line ────────────────────────────────────────────────────────
      // Through the same path as the panel's own remove, so the scale is
      // re-resolved from what is left rather than outliving its evidence.
      if (selectedScaleLineIndex !== null) {
        const doomed = useAppStore.getState().scaleLines[selectedScaleLineIndex];
        if (doomed) removeScaleLine(doomed.id);
        setSelectedScaleLineIndex(null);
        return;
      }
      // ── end scale line ────────────────────────────────────────────────────

      // ── void tool ──────────────────────────────────────────────────────────
      if (selectedHole) {
        onSaveUndoPoint?.();
        useAppStore.getState().removeHole(selectedHole.traceId, selectedHole.holeId);
        setSelectedHole(null);
        return;
      }
      // ── end void tool ──────────────────────────────────────────────────────

      if (selectedCustomShapeIndex !== null && onCustomShapesChange) {
        onCustomShapesChange(customShapes.filter((_, index) => index !== selectedCustomShapeIndex));
        setSelectedCustomShapeIndex(null);
        return;
      }

      if (selectedVertexIndex !== null && onDeletePerimeterVertex) {
        // Selection is left alone: the delete is refused below three vertices,
        // and the vertex array changing identity clears it on success.
        onDeletePerimeterVertex(selectedVertexIndex);
        return;
      }
      // ── end delete targets ────────────────────────────────────────────────
      return;
    }

    if (e.key === 'Escape') {
      // First Escape drops the stroke in progress, second leaves draw mode —
      // so a mis-started stroke does not cost the strokes already painted.
      if (drawModeActive) {
        if (!drawTool.cancelDraw()) onDrawModeToggle?.();
        return;
      }
      // ── void tool ──────────────────────────────────────────────────────────
      // Same two-stage shape as draw mode: drop the shape in progress first, so
      // a mis-started void does not cost the tool.
      if (voidToolActive) {
        if (!voidTool.cancelVoid()) onVoidToolToggle?.();
        return;
      }
      // ── end void tool ──────────────────────────────────────────────────────
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
      // ── scale line ──────────────────────────────────────────────────────
      // No undo point: the only state this clears is the gesture in progress,
      // and the committed lines and calibration are untouched.
      } else if (scaleToolActive) {
        useAppStore.getState().setCurrentScaleLine(null);
        useAppStore.getState().setScaleToolActive(false);
        setLocalScaleLine(null);
      // ── end scale line ──────────────────────────────────────────────────
      } else if (perimeterVertices !== null) {
        useAppStore.getState().setPerimeterVertices(null);
      } else if (manualEntryMode) {
        // Without this, Esc left the user in overlay-placement mode with only
        // the standing toast to say so.
        useAppStore.getState().setManualEntryMode(false);
      } else if (selectedVertexIndex !== null) {
        setSelectedVertexIndex?.(null);
      }
      return;
    }

    if (e.key === 'Enter') {
      if (drawModeActive) {
        onFinishDrawMode?.();
        return;
      }
      // ── void tool ──────────────────────────────────────────────────────────
      if (voidToolActive) {
        voidTool.closeVoidPolygon();
        return;
      }
      // ── end void tool ──────────────────────────────────────────────────────
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
    drawModeActive,
    drawTool,
    onDrawModeToggle,
    onFinishDrawMode,
    scaleToolActive,
    selectedScaleLineIndex,
    removeScaleLine,
    setSelectedCustomShapeIndex,
    setSelectedMeasurementLineIndex,
    selectedVertexIndex,
    setSelectedVertexIndex,
    onDeletePerimeterVertex,
    manualEntryMode,
    voidToolActive,
    voidTool,
    onVoidToolToggle,
    selectedHole,
    onSaveUndoPoint,
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
      ensureWallSnapEngine();
    }

    setLocalRoomOverlay(roomOverlay);
    setDraggingRoom(true);
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureWallSnapEngine, onSaveUndoPoint]);

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
      ensureWallSnapEngine();
    }

    setLocalRoomOverlay(roomOverlay);
    setDraggingRoomCorner(corner);
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureWallSnapEngine, onSaveUndoPoint]);

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
    activeScaleLine,
    selectedScaleLineIndex,
    setSelectedScaleLineIndex,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageClick,
    handleStageDoubleClick,
    handleStageContextMenu,
    handleRoomMouseDown,
    handleRoomCornerMouseDown,
    rightClickPannedRef,
    // ── void tool ────────────────────────────────────────────────────────────
    selectedHole,
    setSelectedHole,
    // ── end void tool ────────────────────────────────────────────────────────
  };
}
