import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Rect } from 'react-konva';
import { createImageSnapAnalyzer } from '../utils/imageSnapper';
import { RoomOverlayLayer, PerimeterLayer, MeasurementLayer, ShapeLayer, DimensionOverlay, PerimeterPlacementLayer, getCanvasCoordinates, pointToLineDistance } from './canvas';

const Canvas = React.memo(forwardRef(({
  image,
  roomOverlay,
  perimeterOverlay,
  mode,
  onRoomOverlayUpdate,
  onPerimeterUpdate,
  isProcessing,
  processingMessage,
  detectedDimensions,
  onDimensionSelect,
  showSideLengths,
  pixelsPerFoot,
  manualEntryMode,
  onCanvasClick,
  unit,
  lineToolActive,
  measurementLines,
  currentMeasurementLine,
  onMeasurementLineUpdate,
  onAddMeasurementLine,
  onMeasurementLinesChange,
  drawAreaActive,
  onDrawAreaToggle,
  customShapes,
  currentCustomShape,
  onCustomShapeUpdate,
  onAddCustomShape,
  onCustomShapesChange,
  perimeterVertices,
  onAddPerimeterVertex,
  onClosePerimeter, // New prop to handle closing the shape
  onDeletePerimeterVertex,
  onLineToolToggle,
  autoSnapEnabled,
  debugDetection,
  detectionDebugData,
  onSaveUndoPoint,
  onCancelUndoSave,
  eraserToolActive,
  eraserBrushSize,
  onEraserBrushSizeChange,
  cropToolActive,
  onCropToolToggle,
  onImageUpdate,
}, ref) => {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1); // Track scale imperatively to avoid React reconciliation
  const [imageObj, setImageObj] = useState(null);
  const [isImageReady, setIsImageReady] = useState(false);
  const [draggingVertex, setDraggingVertex] = useState(null);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [roomStart, setRoomStart] = useState(null);
  const [draggingRoomCorner, setDraggingRoomCorner] = useState(null);
  const [selectedMeasurementLineIndex, setSelectedMeasurementLineIndex] = useState(null);
  const [selectedCustomShapeIndex, setSelectedCustomShapeIndex] = useState(null);
  const [currentMousePos, setCurrentMousePos] = useState(null);
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);

  const lastDraggedVertexRef = useRef(null); // Track last dragged vertex index
  const lastDragStartPosRef = useRef(null); // Track starting position before drag
  const lastRoomDragStartRef = useRef(null); // Track room overlay before move/resize
  const isDraggingRef = useRef(false); // Track if any drag operation is in progress
  const dragStartPosRef = useRef(null); // Track initial mouse position to detect drag vs click
  const imageSnapAnalyzerRef = useRef(null);

  // Eraser tool state
  const eraserCanvasRef = useRef(null); // Offscreen canvas for erasing
  const isErasingRef = useRef(false);
  const eraserStartPosRef = useRef(null); // For shift-constrained erasing
  const eraserAxisRef = useRef(null); // 'h' or 'v' or null

  // Crop tool state
  const [cropSelection, setCropSelection] = useState(null); // {x1, y1, x2, y2}
  const isCroppingRef = useRef(false);
  const cropStartRef = useRef(null);

  useEffect(() => {
    if (selectedMeasurementLineIndex !== null && selectedMeasurementLineIndex >= measurementLines.length) {
      setSelectedMeasurementLineIndex(null);
    }
  }, [measurementLines, selectedMeasurementLineIndex]);

  useEffect(() => {
    if (selectedCustomShapeIndex !== null && selectedCustomShapeIndex >= customShapes.length) {
      setSelectedCustomShapeIndex(null);
    }
  }, [customShapes, selectedCustomShapeIndex]);



  // Fit to window function
  const fitToWindow = useCallback(() => {
    if (!imageObj || !containerRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    const containerHeight = containerRef.current.offsetHeight;

    // Ensure we have valid container dimensions
    if (containerWidth <= 0 || containerHeight <= 0) {
      console.warn('Invalid container dimensions for fit to window');
      return;
    }

    const imgWidth = imageObj.width;
    const imgHeight = imageObj.height;

    const scaleX = containerWidth / imgWidth;
    const scaleY = containerHeight / imgHeight;
    const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

    // Ensure scale is reasonable
    const clampedScale = Math.max(0.1, Math.min(5, newScale));

    scaleRef.current = clampedScale;
    setScale(clampedScale);

    // Center the stage
    if (stageRef.current) {
      const stage = stageRef.current;
      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position({
        x: (containerWidth - imgWidth * clampedScale) / 2,
        y: (containerHeight - imgHeight * clampedScale) / 2
      });
      stage.batchDraw();
    }
  }, [imageObj]);

  // Load image
  useEffect(() => {
    if (!image) {
      setImageObj(null);
      setIsImageReady(false);
      return;
    }

    setIsImageReady(false); // Hide image while loading
    const img = new window.Image();
    img.onload = () => {
      setImageObj(img);

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        // Double check that container is available and has dimensions
        if (containerRef.current && img) {
          const containerWidth = containerRef.current.offsetWidth;
          const containerHeight = containerRef.current.offsetHeight;

          // Ensure we have valid container dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            const imgWidth = img.width;
            const imgHeight = img.height;

            const scaleX = containerWidth / imgWidth;
            const scaleY = containerHeight / imgHeight;
            const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

            // Ensure scale is reasonable
            const clampedScale = Math.max(0.1, Math.min(5, newScale));

            scaleRef.current = clampedScale;
            setScale(clampedScale);

            if (stageRef.current) {
              const stage = stageRef.current;
              stage.scale({ x: clampedScale, y: clampedScale });
              stage.position({
                x: (containerWidth - imgWidth * clampedScale) / 2,
                y: (containerHeight - imgHeight * clampedScale) / 2
              });
              stage.batchDraw();
            }
          }
        }

        // Show the image after processing
        setIsImageReady(true);
      });
    };
    img.onerror = () => {
      console.error('Failed to load image');
      setIsImageReady(false);
    };
    img.src = image;
  }, [image]);


  useEffect(() => {
    let cancelled = false;

    const loadAnalyzer = async () => {
      if (!image) {
        imageSnapAnalyzerRef.current = null;
        return;
      }

      try {
        const analyzer = await createImageSnapAnalyzer(image);
        if (!cancelled) {
          imageSnapAnalyzerRef.current = analyzer;
        }
      } catch (error) {
        console.error('Failed to prepare image snap analyzer:', error);
        if (!cancelled) {
          imageSnapAnalyzerRef.current = null;
        }
      }
    };

    loadAnalyzer();

    return () => {
      cancelled = true;
      imageSnapAnalyzerRef.current = null;
    };
  }, [image]);

  const findVertexSnapPoint = useCallback((point) => {
    if (!autoSnapEnabled || !point) {
      return null;
    }

    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findCornerSnap(point);
  }, [autoSnapEnabled]);

  const findVerticalSnap = useCallback((targetX, y1, y2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findVerticalWall(targetX, y1, y2, { searchRadius });
  }, [autoSnapEnabled]);

  const findHorizontalSnap = useCallback((targetY, x1, x2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findHorizontalWall(targetY, x1, x2, { searchRadius });
  }, [autoSnapEnabled]);

  const snapRoomOverlayPosition = useCallback((overlay) => {
    const width = overlay.x2 - overlay.x1;
    const height = overlay.y2 - overlay.y1;

    const leftSnap = findVerticalSnap(overlay.x1, overlay.y1, overlay.y2);
    const rightSnap = findVerticalSnap(overlay.x2, overlay.y1, overlay.y2);
    const topSnap = findHorizontalSnap(overlay.y1, overlay.x1, overlay.x2);
    const bottomSnap = findHorizontalSnap(overlay.y2, overlay.x1, overlay.x2);

    const snapDeltaX = [
      leftSnap !== null ? leftSnap - overlay.x1 : null,
      rightSnap !== null ? rightSnap - overlay.x2 : null,
    ].filter((value) => value !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    const snapDeltaY = [
      topSnap !== null ? topSnap - overlay.y1 : null,
      bottomSnap !== null ? bottomSnap - overlay.y2 : null,
    ].filter((value) => value !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    const result = {
      x1: overlay.x1 + snapDeltaX,
      y1: overlay.y1 + snapDeltaY,
      x2: overlay.x1 + snapDeltaX + width,
      y2: overlay.y1 + snapDeltaY + height,
    };

    // Preserve and translate the polygon so it stays in sync with the rect
    if (Array.isArray(overlay.polygon)) {
      result.polygon = overlay.polygon.map(p => ({
        x: p.x + snapDeltaX,
        y: p.y + snapDeltaY,
      }));
    }
    if (overlay.confidence !== undefined) {
      result.confidence = overlay.confidence;
    }

    return result;
  }, [findHorizontalSnap, findVerticalSnap]);
  useEffect(() => {
    if (imageObj && dimensions.width > 0 && dimensions.height > 0) {
      // Small delay to ensure the layout is stable
      const timeoutId = setTimeout(() => {
        fitToWindow();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [dimensions, imageObj, fitToWindow]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) setDimensions({ width: w, height: h });
    };

    // Initial measurement after layout
    const raf = requestAnimationFrame(measure);

    // Debounced measure to avoid excessive re-renders during resize
    let resizeTimer = null;
    const debouncedMeasure = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 100);
    };

    // Observe future size changes (debounced)
    const ro = new ResizeObserver(debouncedMeasure);
    ro.observe(el);

    // Fallback on window resize as well
    window.addEventListener('resize', debouncedMeasure);

    return () => {
      cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      window.removeEventListener('resize', debouncedMeasure);
    };
  }, []);
  // Expose fitToWindow method
  useImperativeHandle(ref, () => ({
    fitToWindow: () => fitToWindow()
  }));

  // Helper function to convert screen coordinates to canvas coordinates
  const getCanvasCoords = (stage) => getCanvasCoordinates(stage, scaleRef);

  // Handle room overlay dragging (move entire overlay)
  const handleRoomMouseDown = (e) => {
    if (!roomOverlay) return;
    
    // ONLY allow LEFT mouse button (button 0) for dragging
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    // Save undo point BEFORE any drag changes (state still reflects pre-drag position)
    onSaveUndoPoint?.();
    
    // Save initial state for change detection at drag end
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    // Track drag start position
    const canvasPos = getCanvasCoords(e.target.getStage());
    if (canvasPos) {
      dragStartPosRef.current = canvasPos;
    }
    
    setDraggingRoom(true);
    if (canvasPos) {
      setRoomStart(canvasPos);
    }
  };

  // Handle room corner dragging (with snapping)
  const handleRoomCornerMouseDown = (corner, e) => {
    if (!roomOverlay) return;
    
    // ONLY allow LEFT mouse button (button 0) for dragging
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    // Save undo point BEFORE any drag changes (state still reflects pre-drag position)
    onSaveUndoPoint?.();
    
    // Save initial state for change detection at drag end
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    // Track drag start position
    const canvasPos = getCanvasCoords(e.target.getStage());
    if (canvasPos) {
      dragStartPosRef.current = canvasPos;
    }
    
    setDraggingRoomCorner(corner);
  };

  // Handle perimeter vertex dragging (no snapping)
  const handleVertexDragStart = (index) => {
    if (!perimeterOverlay) return;
    
    // Save undo point BEFORE any drag changes (state still reflects pre-drag position)
    onSaveUndoPoint?.();
    
    lastDraggedVertexRef.current = index;
    lastDragStartPosRef.current = { ...perimeterOverlay.vertices[index] };
    
    setDraggingVertex(index);
  };

  // Line-by-line port from PerimeterOverlayControl.xaml.cs:Vertex_MouseMove
  const handleVertexDrag = (index, e) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    const canvasPos = getCanvasCoords(e.target.getStage());
    if (!canvasPos) return;
    
    // No snapping during drag — snapping is applied on vertex release (handleVertexDragEnd)
    // Update only the visual elements, not the actual data
    // In .NET this updates Canvas.SetLeft/SetTop and polygon.Points
    // In React-Konva, we update the state which re-renders, but mark saveAction=false
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = { x: canvasPos.x, y: canvasPos.y };
    
    onPerimeterUpdate(newVertices, false); // Don't save action during drag
  };

  // Line-by-line port from PerimeterOverlayControl.xaml.cs:Vertex_MouseUp
  const handleVertexDragEnd = (index, e) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    
    // Get current position from visual snap or current vertex position
    const currentVertex = perimeterOverlay.vertices[index];
    
    // Apply snapping to intersection points (disabled when Shift is held)
    const shiftHeld = e?.evt?.shiftKey ?? false;
    const snappedPoint = (autoSnapEnabled && !shiftHeld)
      ? findVertexSnapPoint(currentVertex)
      : null;
    
    // Use snapped position if available, otherwise use raw position
    const finalPoint = snappedPoint || currentVertex;
    
    // If vertex didn't actually move, cancel the undo point saved at drag start
    const origVertex = lastDragStartPosRef.current;
    if (origVertex && finalPoint.x === origVertex.x && finalPoint.y === origVertex.y) {
      onCancelUndoSave?.();
      setDraggingVertex(null);
      return;
    }
    
    // Now update the actual data point
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = finalPoint;

    // Undo point was already saved at drag start; just commit the final position
    onPerimeterUpdate(newVertices, false);
    
    // Clean up
    setDraggingVertex(null);
  };

  const handleMeasurementLineSelect = (index, e) => {
    e.cancelBubble = true;
    setSelectedMeasurementLineIndex(index);
    setSelectedCustomShapeIndex(null);
  };

  const handleCustomShapeSelect = (index, e) => {
    e.cancelBubble = true;
    setSelectedCustomShapeIndex(index);
    setSelectedMeasurementLineIndex(null);
  };

  const handleMeasurementLineDragEnd = (index, e) => {
    if (!onMeasurementLinesChange) return;
    e.cancelBubble = true;
    const deltaX = e.target.x();
    const deltaY = e.target.y();
    if (!deltaX && !deltaY) return;

    const nextLines = measurementLines.map((line, lineIndex) => (
      lineIndex === index
        ? {
          ...line,
          start: { x: line.start.x + deltaX, y: line.start.y + deltaY },
          end: { x: line.end.x + deltaX, y: line.end.y + deltaY }
        }
        : line
    ));

    e.target.position({ x: 0, y: 0 });
    onMeasurementLinesChange(nextLines);
  };

  const handleCustomShapeDragEnd = (index, e) => {
    if (!onCustomShapesChange) return;
    e.cancelBubble = true;
    const deltaX = e.target.x();
    const deltaY = e.target.y();
    if (!deltaX && !deltaY) return;

    const nextShapes = customShapes.map((shape, shapeIndex) => (
      shapeIndex === index
        ? {
          ...shape,
          vertices: shape.vertices.map((vertex) => ({
            x: vertex.x + deltaX,
            y: vertex.y + deltaY
          }))
        }
        : shape
    ));

    e.target.position({ x: 0, y: 0 });
    onCustomShapesChange(nextShapes);
  };

  // ── Eraser tool helpers ─────────────────────────────────────────────────────

  /** Initialise an offscreen canvas from the current image for erasing. */
  const initEraserCanvas = useCallback(() => {
    if (!imageObj) return null;
    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageObj, 0, 0);
    return canvas;
  }, [imageObj]);

  /** Paint a white rectangle centred at (x, y) on the offscreen eraser canvas. */
  const eraseAt = useCallback((x, y, brushSize) => {
    const canvas = eraserCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const half = brushSize / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - half, y - half, brushSize, brushSize);
  }, []);

  /** Commit the eraser canvas back to the store image and refresh the Konva node. */
  const commitEraserCanvas = useCallback(() => {
    const canvas = eraserCanvasRef.current;
    if (!canvas || !onImageUpdate) return;
    const dataUrl = canvas.toDataURL('image/png');
    onImageUpdate(dataUrl);
    eraserCanvasRef.current = null;
  }, [onImageUpdate]);

  /** Handle eraser mousedown: start a new erase session. */
  const handleEraserMouseDown = useCallback((stage) => {
    if (!eraserToolActive || !imageObj) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    // Init offscreen canvas
    eraserCanvasRef.current = initEraserCanvas();
    isErasingRef.current = true;
    eraserStartPosRef.current = pos;
    eraserAxisRef.current = null;

    // Paint first stroke
    eraseAt(pos.x, pos.y, eraserBrushSize);

    // Update Konva image from offscreen canvas for immediate visual feedback
    if (stageRef.current) {
      const imgNode = stageRef.current.findOne('Image');
      if (imgNode && eraserCanvasRef.current) {
        imgNode.image(eraserCanvasRef.current);
        imgNode.getLayer()?.batchDraw();
      }
    }

    return true;
  }, [eraserToolActive, imageObj, eraserBrushSize, initEraserCanvas, eraseAt]);

  /** Handle eraser mousemove: continue erasing along the drag path. */
  const handleEraserMouseMove = useCallback((stage, shiftKey) => {
    if (!isErasingRef.current || !eraserCanvasRef.current) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    let drawX = pos.x;
    let drawY = pos.y;

    // Shift constrains to axis
    if (shiftKey && eraserStartPosRef.current) {
      if (!eraserAxisRef.current) {
        const dx = Math.abs(pos.x - eraserStartPosRef.current.x);
        const dy = Math.abs(pos.y - eraserStartPosRef.current.y);
        if (dx > 5 || dy > 5) {
          eraserAxisRef.current = dx >= dy ? 'h' : 'v';
        }
      }
      if (eraserAxisRef.current === 'h') {
        drawY = eraserStartPosRef.current.y;
      } else if (eraserAxisRef.current === 'v') {
        drawX = eraserStartPosRef.current.x;
      }
    } else {
      eraserAxisRef.current = null;
    }

    eraseAt(drawX, drawY, eraserBrushSize);

    // Update Konva image live
    if (stageRef.current) {
      const imgNode = stageRef.current.findOne('Image');
      if (imgNode && eraserCanvasRef.current) {
        imgNode.image(eraserCanvasRef.current);
        imgNode.getLayer()?.batchDraw();
      }
    }

    return true;
  }, [eraserBrushSize, eraseAt]);

  /** Handle eraser mouseup: commit the erased image to the store. */
  const handleEraserMouseUp = useCallback(() => {
    if (!isErasingRef.current) return false;
    isErasingRef.current = false;
    eraserStartPosRef.current = null;
    eraserAxisRef.current = null;
    commitEraserCanvas();
    return true;
  }, [commitEraserCanvas]);

  // ── Crop tool helpers ───────────────────────────────────────────────────────

  /** Reset crop tool state to idle. */
  const resetCropState = useCallback(() => {
    isCroppingRef.current = false;
    cropStartRef.current = null;
    setCropSelection(null);
  }, []);

  /** Handle crop mousedown: start the selection. */
  const handleCropMouseDown = useCallback((stage) => {
    if (!cropToolActive || !imageObj) return false;
    const pos = getCanvasCoords(stage);
    if (!pos) return false;

    isCroppingRef.current = true;
    cropStartRef.current = pos;
    setCropSelection({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
    return true;
  }, [cropToolActive, imageObj]);

  /** Handle crop mousemove: update the selection rectangle. */
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
  }, []);

  /** Handle crop mouseup: apply the crop. */
  const handleCropMouseUp = useCallback(() => {
    if (!isCroppingRef.current || !cropStartRef.current || !imageObj || !onImageUpdate) {
      resetCropState();
      return false;
    }

    // Compute the normalised crop rectangle
    const sel = cropSelection;
    if (!sel) { resetCropState(); return false; }

    const cx1 = Math.max(0, Math.min(sel.x1, sel.x2));
    const cy1 = Math.max(0, Math.min(sel.y1, sel.y2));
    const cx2 = Math.min(imageObj.width, Math.max(sel.x1, sel.x2));
    const cy2 = Math.min(imageObj.height, Math.max(sel.y1, sel.y2));
    const cw = cx2 - cx1;
    const ch = cy2 - cy1;

    resetCropState();

    // Ignore tiny selections (accidental clicks)
    if (cw < 10 || ch < 10) return false;

    // Keep the full image size; fill everything outside the selection with white
    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, imageObj.width, imageObj.height);
    ctx.drawImage(imageObj, cx1, cy1, cw, ch, cx1, cy1, cw, ch);

    const dataUrl = canvas.toDataURL('image/png');
    onImageUpdate(dataUrl);
    // Deselect the crop tool – we only want to crop once per activation
    if (onCropToolToggle) onCropToolToggle();
    return true;
  }, [imageObj, cropSelection, onImageUpdate, onCropToolToggle, resetCropState]);

  // Handle double-click to close custom shape or add perimeter vertex
  const handleStageDoubleClick = (e) => {
    // IMPORTANT: Only respond to LEFT double-click (button 0)
    if (e.evt && e.evt.button !== 0) return;

    // Line tool: a double click finishes the line
    if (lineToolActive && currentMeasurementLine && currentMeasurementLine.start) {
      const stage = e.target.getStage();
      if (!stage) return;
      const finalPoint = getCanvasCoords(stage);
      if (!finalPoint) return;

      const newLine = { start: currentMeasurementLine.start, end: finalPoint };
      onAddMeasurementLine(newLine);
      onMeasurementLineUpdate(null); // Reset for next line
      return;
    }

    // Draw area tool - close the shape
    if (drawAreaActive && currentCustomShape && !currentCustomShape.closed && currentCustomShape.vertices.length >= 3) {
      const finalShape = { ...currentCustomShape, closed: true };
      onAddCustomShape(finalShape);
      onCustomShapeUpdate(null); // Reset for next shape
      return;
    }

    // Perimeter tool - add vertex (only when no tools are active)
    if (!perimeterOverlay || drawAreaActive || manualEntryMode || lineToolActive) return;
    
    // Don't add vertex if clicking on a perimeter vertex (Circle)
    const targetType = e.target.getType();
    if (targetType === 'Circle') return; // Prevent adding vertex when clicking on existing vertices
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const clickPoint = getCanvasCoords(stage);
    if (!clickPoint) return;
    
    // Apply snapping to corner points
    const snappedPoint = autoSnapEnabled
      ? findVertexSnapPoint(clickPoint)
      : null;
    
    // Use snapped position if available, otherwise use raw position
    const finalPoint = snappedPoint || clickPoint;
    
    // Find the closest edge to insert the new vertex
    const vertices = perimeterOverlay.vertices;
    let closestEdgeIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      
      // Calculate distance from point to line segment
      const distance = pointToLineDistance(clickPoint, v1, v2);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestEdgeIndex = i;
      }
    }
    
    // Insert the new vertex after the closest edge start
    const newVertices = [...vertices];
    newVertices.splice(closestEdgeIndex + 1, 0, finalPoint);

    onPerimeterUpdate(newVertices, true); // Save action for undo
  };




  // Handle global mouse move for dragging
  const handleStageMouseMove = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const mousePoint = getCanvasCoords(stage);
    if (!mousePoint) return;
    
    setCurrentMousePos(mousePoint);

    // Eraser tool: continuous erase during drag
    if (eraserToolActive && isErasingRef.current) {
      handleEraserMouseMove(stage, e.evt.shiftKey);
      return;
    }

    // Crop tool: update selection rectangle during drag
    if (cropToolActive && isCroppingRef.current) {
      handleCropMouseMove(stage);
      return;
    }
    
    // Detect if mouse has moved enough to be considered a drag
    if (dragStartPosRef.current && !isDraggingRef.current) {
      const dx = mousePoint.x - dragStartPosRef.current.x;
      const dy = mousePoint.y - dragStartPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // If moved more than 3 pixels, consider it a drag
      if (distance > 3) {
        isDraggingRef.current = true;
      }
    }
    
    // Handle room overlay dragging with live edge scans.
    // Holding Shift disables auto-snapping for precise placement.
    if (draggingRoom && roomStart) {
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;
      
      const movedOverlay = {
        x1: roomOverlay.x1 + deltaX,
        y1: roomOverlay.y1 + deltaY,
        x2: roomOverlay.x2 + deltaX,
        y2: roomOverlay.y2 + deltaY,
        // Translate polygon along with the bounding rect so the outline stays in sync
        ...(Array.isArray(roomOverlay.polygon)
          ? { polygon: roomOverlay.polygon.map(p => ({ x: p.x + deltaX, y: p.y + deltaY })) }
          : {}),
        ...(roomOverlay.confidence !== undefined ? { confidence: roomOverlay.confidence } : {}),
      };
      
      const shiftHeld = e.evt.shiftKey;
      const newOverlay = (autoSnapEnabled && !shiftHeld) ? snapRoomOverlayPosition(movedOverlay) : movedOverlay;
      onRoomOverlayUpdate(newOverlay, false); // Don't save action during drag
      setRoomStart(mousePoint);
      return;
    }
    
    // Handle room corner dragging with local edge scans while resizing.
    // Holding Shift disables auto-snapping for precise placement.
    if (draggingRoomCorner && roomOverlay) {
      // Only copy coordinates (and confidence metadata) — resizing invalidates
      // the detected polygon boundary so it is intentionally not preserved.
      const newOverlay = { x1: roomOverlay.x1, y1: roomOverlay.y1, x2: roomOverlay.x2, y2: roomOverlay.y2 };
      if (roomOverlay.confidence !== undefined) {
        newOverlay.confidence = roomOverlay.confidence;
      }
      const shiftHeld = e.evt.shiftKey;
      
      if (draggingRoomCorner === 'tl') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, roomOverlay.y2, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, mousePoint.x, roomOverlay.x2) : null;
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, roomOverlay.y2, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, roomOverlay.x1, mousePoint.x) : null;
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, roomOverlay.y1, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, mousePoint.x, roomOverlay.x2) : null;
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        const snappedX = !shiftHeld ? findVerticalSnap(mousePoint.x, roomOverlay.y1, mousePoint.y) : null;
        const snappedY = !shiftHeld ? findHorizontalSnap(mousePoint.y, roomOverlay.x1, mousePoint.x) : null;
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      }
      
      onRoomOverlayUpdate(newOverlay, false); // Don't save action during drag
      return;
    }
    
    // Line tool preview
    if (lineToolActive && currentMeasurementLine && currentMeasurementLine.start && onMeasurementLineUpdate) {
      onMeasurementLineUpdate({
        start: currentMeasurementLine.start,
        end: mousePoint
      });
    }

    // Custom shape preview
    if (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) {
      setCurrentMousePos(mousePoint);
    }
  };
  
  // Handle global mouse up
  const handleStageMouseUp = () => {
    // Eraser tool: commit the erased image
    if (isErasingRef.current) {
      handleEraserMouseUp();
      return;
    }

    // Crop tool: apply the crop
    if (isCroppingRef.current) {
      handleCropMouseUp();
      return;
    }

    if (draggingRoom) {
      // If room didn't actually move, cancel the undo point saved at drag start
      if (lastRoomDragStartRef.current && roomOverlay) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== roomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== roomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== roomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== roomOverlay.y2;
        
        if (!changed) {
          onCancelUndoSave?.();
        }
        // The final overlay state is already in the store from intermediate drag updates
      }
      setDraggingRoom(false);
      setRoomStart(null);
      lastRoomDragStartRef.current = null;
    }
    if (draggingRoomCorner) {
      // If room size didn't actually change, cancel the undo point saved at drag start
      if (lastRoomDragStartRef.current && roomOverlay) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== roomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== roomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== roomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== roomOverlay.y2;
        
        if (!changed) {
          onCancelUndoSave?.();
        }
        // The final overlay state is already in the store from intermediate drag updates
      }
      setDraggingRoomCorner(null);
      lastRoomDragStartRef.current = null;
    }
    
    // Reset drag tracking after a short delay to prevent click from firing
    if (isDraggingRef.current) {
      setTimeout(() => {
        isDraggingRef.current = false;
        dragStartPosRef.current = null;
      }, 100);
    } else {
      // No drag occurred, reset immediately
      dragStartPosRef.current = null;
    }
  };

  // Handle Stage mousedown for eraser/crop tool
  const handleStageMouseDown = useCallback((e) => {
    // Only handle left mouse button
    if (e.evt && e.evt.button !== 0) return;

    const stage = e.target.getStage();
    if (!stage) return;

    if (eraserToolActive) {
      e.cancelBubble = true;
      e.evt.preventDefault();
      handleEraserMouseDown(stage);
      return;
    }

    if (cropToolActive) {
      e.cancelBubble = true;
      e.evt.preventDefault();
      handleCropMouseDown(stage);
      return;
    }
  }, [eraserToolActive, cropToolActive, handleEraserMouseDown, handleCropMouseDown]);
  const handleStageClick = (e) => {
    // Ignore right-clicks (button=2) and side mouse buttons (button=3/4);
    // right-clicks are handled by handleStageContextMenu, and side buttons are
    // reserved for undo/redo.
    if (e.evt.button === 2 || e.evt.button === 3 || e.evt.button === 4) {
      return;
    }

    // Ignore clicks that occurred after a drag operation
    if (isDraggingRef.current) {
      return;
    }

    // Eraser and crop tools handle their own mousedown/mouseup; skip click processing
    if (eraserToolActive || cropToolActive) {
      return;
    }

    const target = e.target;
    if (target?.hasName?.('measurement-line') || target?.hasName?.('custom-shape')) {
      return;
    }

    setSelectedMeasurementLineIndex(null);
    setSelectedCustomShapeIndex(null);
    
    // Check if we're in a mode that needs single-click handling
    const needsSingleClickHandling = 
      (manualEntryMode && onCanvasClick) ||
      (roomOverlay && !perimeterOverlay && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== null) ||
      (lineToolActive && onMeasurementLineUpdate) ||
      (drawAreaActive && onCustomShapeUpdate);
    
    // If we don't need single-click handling, just return immediately
    // This allows double-click to work without interference
    if (!needsSingleClickHandling) {
      return;
    }
    
    // Increment click count
    clickCountRef.current += 1;
    
    // Clear any existing timeout
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }
    
    // Set a timeout to reset click count
    clickTimeoutRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 300); // 300ms window for double-click detection
    
    // If this is a double-click, let the double-click handler deal with it
    if (clickCountRef.current >= 2) {
      // We are handling double click separately in handleStageDoubleClick
      // so we just reset and return here to avoid single click logic firing.
      clickCountRef.current = 0;
      clearTimeout(clickTimeoutRef.current);
      return;
    }
    
    // Wait a bit to see if a second click comes (to avoid processing single click when double-clicking)
    setTimeout(() => {
      if (clickCountRef.current !== 1) return; // A double-click happened, skip single-click processing
      
      // Manual entry mode takes priority
      if (manualEntryMode && onCanvasClick) {
        const stage = e.target.getStage();
        if (!stage) return;
        
        const clickPoint = getCanvasCoords(stage);
        if (!clickPoint) return;
        
        onCanvasClick(clickPoint);
        return;
      }
      
      // Perimeter vertex placement mode (only active after manual mode or trace perimeter)
      // perimeterVertices !== null means user has explicitly entered vertex placement mode
      if (roomOverlay && !perimeterOverlay && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== null) {
        // Don't place vertex if clicking on room overlay (allow dragging though)
        const targetType = e.target.getType();
        if (targetType === 'Rect' || targetType === 'Circle') {
          return; // Clicked on room overlay or its handles
        }
        
        const stage = e.target.getStage();
        if (!stage) return;
        
        const clickPoint = getCanvasCoords(stage);
        if (!clickPoint) return;
        
        // Apply snapping to corner points
        const snappedPoint = autoSnapEnabled
          ? findVertexSnapPoint(clickPoint)
          : null;
        
        // Use snapped position if available, otherwise use raw position
        const finalPoint = snappedPoint || clickPoint;
        
        // Check if clicking on the first vertex to close the shape
        if (perimeterVertices && perimeterVertices.length > 2) {
          const firstVertex = perimeterVertices[0];
          const dx = finalPoint.x - firstVertex.x;
          const dy = finalPoint.y - firstVertex.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 10 / scaleRef.current) {
            // Close the shape
            if (onClosePerimeter) {
              onClosePerimeter();
            }
            return;
          }
        }

        onAddPerimeterVertex(finalPoint);
        return;
      }
      
      // Line tool mode
      if (lineToolActive && onMeasurementLineUpdate) {
        const stage = e.target.getStage();
        if (!stage) return;
        const clickPoint = getCanvasCoords(stage);
        if (!clickPoint) return;

        if (!currentMeasurementLine) {
          // Start a new line
          onMeasurementLineUpdate({ start: clickPoint, end: clickPoint });
        } else {
          // Finish the current line
          const newLine = { start: currentMeasurementLine.start, end: clickPoint };
          onAddMeasurementLine(newLine);
          onMeasurementLineUpdate(null); // Reset for the next line
        }
        return;
      }

      // Draw area tool mode (functions like perimeter tracing)
      if (drawAreaActive && onCustomShapeUpdate) {
        const stage = e.target.getStage();
        if (!stage) return;
        const clickPoint = getCanvasCoords(stage);
        if (!clickPoint) return;

        if (!currentCustomShape) {
          // Start a new shape
          onCustomShapeUpdate({ vertices: [clickPoint], closed: false });
        } else {
          // Check if closing the shape by clicking the first vertex
          const firstVertex = currentCustomShape.vertices[0];
          const distance = Math.sqrt(Math.pow(clickPoint.x - firstVertex.x, 2) + Math.pow(clickPoint.y - firstVertex.y, 2));

          if (currentCustomShape.vertices.length > 2 && distance < 10 / scaleRef.current) {
            // Close the shape
            const finalShape = { ...currentCustomShape, closed: true };
            onAddCustomShape(finalShape);
            onCustomShapeUpdate(null); // Reset for next shape
          } else {
            // Add a new vertex
            const newVertices = [...currentCustomShape.vertices, clickPoint];
            onCustomShapeUpdate({ ...currentCustomShape, vertices: newVertices });
          }
        }
        return;
      }
    }, 50); // Wait 50ms to distinguish single from double-click (faster response)
  };
  
  // Handle right click on the stage background.
  // If the line tool is active and a line is in progress, right-click cancels it.
  // If the crop tool is active and a selection is in progress, right-click cancels it.
  const handleStageContextMenu = (e) => {
    e.evt.preventDefault();

    if (cropToolActive && isCroppingRef.current) {
      resetCropState();
      return;
    }

    if (lineToolActive && currentMeasurementLine && onMeasurementLineUpdate) {
      onMeasurementLineUpdate(null);
    }
  };
  

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  // Handle mouseup outside the canvas to commit eraser/crop operations
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isErasingRef.current) {
        handleEraserMouseUp();
      }
      if (isCroppingRef.current) {
        handleCropMouseUp();
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [handleEraserMouseUp, handleCropMouseUp]);

  // Handle zoom
  const handleWheel = (e) => {
    e.evt.preventDefault();
    e.evt.stopPropagation();
    
    const stage = stageRef.current;
    if (!stage) return;

    // Mark that we're zooming to prevent drag conflicts
    isZoomingRef.current = true;
    
    // Clear any existing timeout
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
    
    // Get the current stage position
    const stagePos = stage.position();
    
    // Calculate the point in the image that the mouse is over
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.1; // Doubled sensitivity from 1.05
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    // Clamp scale to reasonable bounds
    const clampedScale = Math.max(0.1, Math.min(20, newScale));
    
    // Calculate new position to keep the mouse point fixed
    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    };
    
    // Update ref immediately for next wheel event
    scaleRef.current = clampedScale;
    
    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
      // Apply all transformations in one batch
      stage.setAttrs({
        scaleX: clampedScale,
        scaleY: clampedScale,
        x: newPos.x,
        y: newPos.y
      });
      // Keep React state in sync so stroke widths, labels, and hit targets match the stage scale
      setScale(clampedScale);

      stage.batchDraw();
    });
  };

  // Handle Stage drag start (for panning)
  const handleStageDragStart = () => {
    const stage = stageRef.current;
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (pos) {
      const stagePos = stage.position();
      const currentScale = scaleRef.current;
      dragStartPosRef.current = {
        x: (pos.x - stagePos.x) / currentScale,
        y: (pos.y - stagePos.y) / currentScale
      };
    }
  };
  
  // Handle Stage drag end (for panning)
  const handleStageDragEnd = () => {
    // Mark as dragging to prevent click event
    if (dragStartPosRef.current) {
      isDraggingRef.current = true;
      
      // Reset after a delay
      setTimeout(() => {
        isDraggingRef.current = false;
        dragStartPosRef.current = null;
      }, 100);
    }
  };

  const handleKeyDown = useCallback((e) => {
    const activeElement = document.activeElement;
    const isTypingIntoField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );

    if (isTypingIntoField) {
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace')) {
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
        // Cancel any in-progress erase and restore the original image on the Konva node
        if (isErasingRef.current) {
          isErasingRef.current = false;
          eraserCanvasRef.current = null;
          eraserStartPosRef.current = null;
          eraserAxisRef.current = null;
          // Restore original image object on the Konva Image node
          if (stageRef.current && imageObj) {
            const imgNode = stageRef.current.findOne('Image');
            if (imgNode) {
              imgNode.image(imageObj);
              imgNode.getLayer()?.batchDraw();
            }
          }
        }
      } else if (cropToolActive) {
        // Cancel any in-progress crop selection
        resetCropState();
      } else if (lineToolActive && onLineToolToggle) {
        onLineToolToggle();
      } else if (drawAreaActive && onDrawAreaToggle) {
        onDrawAreaToggle();
      }
      return;
    }

    if (e.key === 'Enter') {
      // Close perimeter on Enter key
      if (perimeterVertices && perimeterVertices.length > 2 && onClosePerimeter) {
        onClosePerimeter();
      }
      // Close custom shape on Enter key
      else if (drawAreaActive && currentCustomShape && !currentCustomShape.closed && currentCustomShape.vertices.length >= 2) {
        const finalShape = { ...currentCustomShape, closed: true };
        onAddCustomShape(finalShape);
        onCustomShapeUpdate(null); // Reset for next shape
      }
    }
  }, [
    eraserToolActive,
    cropToolActive,
    resetCropState,
    lineToolActive,
    onLineToolToggle,
    perimeterVertices,
    onClosePerimeter,
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
    customShapes
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div ref={containerRef} className="absolute inset-0 canvas-grid-bg" style={{ cursor: 'default' }}>
      {!image && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-slate-200/80 flex items-center justify-center">
              <svg className="w-7 h-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="M15 3v18" />
                <path d="M3 9h18" />
                <path d="M3 15h18" />
              </svg>
            </div>
            <p className="text-base font-semibold text-slate-500 mb-1">
              No floor plan loaded
            </p>
            <p className="text-sm text-slate-400">
              Paste an image <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-200 rounded text-slate-500">Ctrl+V</kbd> or open a file <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-200 rounded text-slate-500">Ctrl+O</kbd>
            </p>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="absolute inset-0 flex items-start justify-center pt-3 z-10 pointer-events-none">
          <div className="bg-chrome-800 border border-chrome-700 rounded-lg px-5 py-3.5 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent/30 border-t-accent"></div>
              <span className="text-sm text-slate-200 font-medium">{processingMessage || 'Working…'}</span>
            </div>
          </div>
        </div>
      )}
      
      {imageObj && (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onWheel={handleWheel}
          draggable={!draggingRoom && !draggingRoomCorner && draggingVertex === null && !isZoomingRef.current && !manualEntryMode && !(roomOverlay && !perimeterOverlay) && !eraserToolActive && !cropToolActive}
          onDragStart={handleStageDragStart}
          onDragEnd={handleStageDragEnd}
          onMouseDown={handleStageMouseDown}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onContextMenu={handleStageContextMenu}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onDblClick={handleStageDoubleClick}
          onDblTap={handleStageDoubleClick}
          style={{ cursor: eraserToolActive ? 'none' : cropToolActive ? 'crosshair' : 'default' }}
        >
          <Layer>
            {/* Main Image - only show when ready */}
            {isImageReady && (
              <KonvaImage
                image={imageObj}
                x={0}
                y={0}
              />
            )}

            {/* Perimeter Overlay - Outline and vertices with side-length labels */}
            <PerimeterLayer
              perimeterOverlay={perimeterOverlay}
              scale={scale}
              showSideLengths={showSideLengths}
              pixelsPerFoot={pixelsPerFoot}
              detectedDimensions={detectedDimensions}
              unit={unit}
              onVertexDragStart={handleVertexDragStart}
              onVertexDrag={handleVertexDrag}
              onVertexDragEnd={handleVertexDragEnd}
              onDeletePerimeterVertex={onDeletePerimeterVertex}
              onDoubleClick={handleStageDoubleClick}
            />

            {/* Room Overlay - Render above perimeter line but below perimeter vertices */}
            <RoomOverlayLayer
              roomOverlay={roomOverlay}
              scale={scale}
              debugDetection={debugDetection}
              onRoomMouseDown={handleRoomMouseDown}
              onRoomCornerMouseDown={handleRoomCornerMouseDown}
            />

            {debugDetection && detectionDebugData?.dominantAngles?.length > 0 && (
              <Text
                x={10}
                y={34}
                text={`Angles: ${detectionDebugData.dominantAngles.join(', ')}`}
                fontSize={12 / scale}
                fill="#8BE9FD"
                listening={false}
              />
            )}

            {/* Manual Mode - Detected Dimensions Highlights */}
            <DimensionOverlay
              mode={mode}
              detectedDimensions={detectedDimensions}
              scale={scale}
              unit={unit}
              stageRef={stageRef}
              onDimensionSelect={onDimensionSelect}
            />
            
            {/* Manual Entry Mode - Click to place overlays */}
            {manualEntryMode && (
              <Text
                x={10}
                y={10}
                text="Click on the canvas to place overlays"
                fontSize={16 / scale}
                fill="#8BE9FD"
                fontStyle="bold"
              />
            )}
            
            {/* Perimeter Vertex Placement Mode */}
            <PerimeterPlacementLayer
              roomOverlay={roomOverlay}
              perimeterOverlay={perimeterOverlay}
              perimeterVertices={perimeterVertices}
              currentMousePos={currentMousePos}
              lineToolActive={lineToolActive}
              drawAreaActive={drawAreaActive}
              manualEntryMode={manualEntryMode}
              scale={scale}
            />
            
          </Layer>

          {/* Measurement Lines & Preview */}
          <MeasurementLayer
            measurementLines={measurementLines}
            currentMeasurementLine={currentMeasurementLine}
            lineToolActive={lineToolActive}
            scale={scale}
            pixelsPerFoot={pixelsPerFoot}
            unit={unit}
            selectedMeasurementLineIndex={selectedMeasurementLineIndex}
            onMeasurementLineSelect={handleMeasurementLineSelect}
            onMeasurementLineDragEnd={handleMeasurementLineDragEnd}
            onMeasurementLinesChange={onMeasurementLinesChange}
          />

          {/* Custom Shapes & Preview */}
          <ShapeLayer
            customShapes={customShapes}
            currentCustomShape={currentCustomShape}
            currentMousePos={currentMousePos}
            drawAreaActive={drawAreaActive}
            scale={scale}
            pixelsPerFoot={pixelsPerFoot}
            unit={unit}
            selectedCustomShapeIndex={selectedCustomShapeIndex}
            onCustomShapeSelect={handleCustomShapeSelect}
            onCustomShapeDragEnd={handleCustomShapeDragEnd}
          />

          {/* Eraser cursor and crop selection overlay */}
          <Layer listening={false}>
            {/* Eraser brush cursor */}
            {eraserToolActive && currentMousePos && (
              <Rect
                x={currentMousePos.x - eraserBrushSize / 2}
                y={currentMousePos.y - eraserBrushSize / 2}
                width={eraserBrushSize}
                height={eraserBrushSize}
                stroke="#8BE9FD"
                strokeWidth={1.5 / scale}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            )}

            {/* Crop selection overlay */}
            {cropToolActive && cropSelection && (() => {
              const sx = Math.min(cropSelection.x1, cropSelection.x2);
              const sy = Math.min(cropSelection.y1, cropSelection.y2);
              const sw = Math.abs(cropSelection.x2 - cropSelection.x1);
              const sh = Math.abs(cropSelection.y2 - cropSelection.y1);
              return (
                <>
                  {/* Selection border */}
                  <Rect
                    x={sx}
                    y={sy}
                    width={sw}
                    height={sh}
                    stroke="#8BE9FD"
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 4 / scale]}
                    listening={false}
                  />
                </>
              );
            })()}
          </Layer>
        </Stage>
      )}
    </div>
  );
}));

Canvas.displayName = 'Canvas';

export default Canvas;
