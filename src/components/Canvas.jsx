import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Group, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
import { formatLength } from '../utils/unitConverter';
import { calculateArea, getCentroid } from '../utils/areaCalculator';
import { createImageSnapAnalyzer } from '../utils/imageSnapper';

/** Font family and style used for OCR pill badge text (must match the Konva Text element). */
const OCR_PILL_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const OCR_PILL_FONT_STYLE = 'bold';
/** Cached canvas 2D context used for text measurement – avoids repeated DOM element creation. */
const _measureCtx = document.createElement('canvas').getContext('2d');
/** Measure the rendered pixel width of a text string using the Canvas 2D API. */
function measureTextWidth(text, fontSize) {
  _measureCtx.font = `${OCR_PILL_FONT_STYLE} ${fontSize}px ${OCR_PILL_FONT_FAMILY}`;
  return _measureCtx.measureText(text).width;
}
/** Base dot radius (canvas units) for the OCR anchor dot before scale division. */
const OCR_DOT_BASE_RADIUS = 3;
/** Minimum rendered dot radius in pixels for the OCR anchor dot. */
const OCR_DOT_MIN_RADIUS = 2;

/** Cycling colors for measurement lines (Dracula color scheme). */
const LINE_COLORS = [
  { normal: '#FFB86C', selected: '#FFCA99' }, // Dracula Orange
  { normal: '#8BE9FD', selected: '#A8F0FF' }, // Dracula Cyan
  { normal: '#50FA7B', selected: '#7AFFA0' }, // Dracula Green
  { normal: '#BD93F9', selected: '#D2B8FC' }, // Dracula Purple
  { normal: '#FF79C6', selected: '#FFA8D9' }, // Dracula Pink
];

/** Layout for measurement line: split stroke so it never crosses the label; offset label when the segment is too short. */
const getMeasurementLineLayout = (line, scale, pixelsPerFoot, unit) => {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const lenPx = Math.sqrt(dx * dx + dy * dy);
  const lengthFeet = lenPx * pixelsPerFoot;
  const textStr = `${formatLength(lengthFeet, unit)}`;
  const fontSize = 12 / scale;
  const ux = lenPx > 1e-6 ? dx / lenPx : 1;
  const uy = lenPx > 1e-6 ? dy / lenPx : 0;
  const mx = (line.start.x + line.end.x) / 2;
  const my = (line.start.y + line.end.y) / 2;
  const nx = -uy;
  const ny = ux;

  const approxPad = 6 / scale;
  const approxCharW = fontSize * 0.58;
  const approxTextWidth = Math.max(textStr.length * approxCharW, fontSize * 2.5);
  const approxTextHeight = fontSize * 1.25;

  const extentAlongLine =
    (approxTextWidth * Math.abs(ux) + approxTextHeight * Math.abs(uy)) / 2 + approxPad;
  const maxHalfGap = Math.max(0, lenPx / 2 - 0.5 / scale);
  const halfGap = Math.min(extentAlongLine, maxHalfGap);
  const needsPerpendicularLift = maxHalfGap < extentAlongLine - 1e-3;
  const halfExtentOnNormal =
    (approxTextWidth / 2) * Math.abs(nx) + (approxTextHeight / 2) * Math.abs(ny);
  const liftPerp = needsPerpendicularLift ? halfExtentOnNormal + 4 / scale : 0;

  const labelX = mx + nx * liftPerp;
  const labelY = my + ny * liftPerp;

  const line1End = { x: mx - ux * halfGap, y: my - uy * halfGap };
  const line2Start = { x: mx + ux * halfGap, y: my + uy * halfGap };

  return {
    textStr,
    fontSize,
    labelX,
    labelY,
    approxTextWidth,
    approxTextHeight,
    line1Points: [line.start.x, line.start.y, line1End.x, line1End.y],
    line2Points: [line2Start.x, line2Start.y, line.end.x, line.end.y],
  };
};

const Canvas = forwardRef(({
  image,
  roomOverlay,
  perimeterOverlay,
  mode,
  onRoomOverlayUpdate,
  onPerimeterUpdate,
  isProcessing,
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
  customShapes,
  currentCustomShape,
  onCustomShapeUpdate,
  onAddCustomShape,
  onCustomShapesChange,
  perimeterVertices,
  onAddPerimeterVertex,
  onClosePerimeter, // New prop to handle closing the shape
  onDeletePerimeterVertex,
  autoSnapEnabled,
  debugDetection,
  detectionDebugData,
  onUndo,
  onRedo
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
  const rightClickTimeoutRef = useRef(null);
  const lastDraggedVertexRef = useRef(null); // Track last dragged vertex index
  const lastDragStartPosRef = useRef(null); // Track starting position before drag
  const lastRoomDragStartRef = useRef(null); // Track room overlay before move/resize
  const isDraggingRef = useRef(false); // Track if any drag operation is in progress
  const dragStartPosRef = useRef(null); // Track initial mouse position to detect drag vs click
  const imageSnapAnalyzerRef = useRef(null);

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

    return {
      x1: overlay.x1 + snapDeltaX,
      y1: overlay.y1 + snapDeltaY,
      x2: overlay.x1 + snapDeltaX + width,
      y2: overlay.y1 + snapDeltaY + height,
    };
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

    // Observe future size changes
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    // Fallback on window resize as well
    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);
  // Expose fitToWindow method
  useImperativeHandle(ref, () => ({
    fitToWindow: () => fitToWindow()
  }));

  // Helper function to convert screen coordinates to canvas coordinates
  const getCanvasCoordinates = (stage) => {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    
    const stagePos = stage.position();
    const currentScale = scaleRef.current;
    
    return {
      x: (pos.x - stagePos.x) / currentScale,
      y: (pos.y - stagePos.y) / currentScale
    };
  };

  // Handle room overlay dragging (move entire overlay)
  const handleRoomMouseDown = (e) => {
    if (!roomOverlay || lineToolActive || drawAreaActive) return;
    
    // ONLY allow LEFT mouse button (button 0) for dragging
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    // Save initial state for undo
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    // Track drag start position
    const canvasPos = getCanvasCoordinates(e.target.getStage());
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
    if (!roomOverlay || lineToolActive || drawAreaActive) return;
    
    // ONLY allow LEFT mouse button (button 0) for dragging
    if (e.evt && e.evt.button !== 0) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    // Save initial state for undo
    lastRoomDragStartRef.current = { ...roomOverlay };
    
    // Track drag start position
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (canvasPos) {
      dragStartPosRef.current = canvasPos;
    }
    
    setDraggingRoomCorner(corner);
  };

  // Handle perimeter vertex dragging (no snapping)
  const handleVertexDragStart = (index) => {
    if (!perimeterOverlay || lineToolActive || drawAreaActive) return;
    
    // Save initial position for undo
    lastDraggedVertexRef.current = index;
    lastDragStartPosRef.current = { ...perimeterOverlay.vertices[index] };
    
    setDraggingVertex(index);
  };

  // Line-by-line port from PerimeterOverlayControl.xaml.cs:Vertex_MouseMove
  const handleVertexDrag = (index, e) => {
    if (!perimeterOverlay || draggingVertex !== index || lineToolActive || drawAreaActive) return;
    const canvasPos = getCanvasCoordinates(e.target.getStage());
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
  const handleVertexDragEnd = (index) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    
    // Build the previous state with the original position
    const previousVertices = lastDragStartPosRef.current ? 
      perimeterOverlay.vertices.map((v, i) => 
        i === index ? lastDragStartPosRef.current : v
      ) : null;
    
    // Get current position from visual snap or current vertex position
    const currentVertex = perimeterOverlay.vertices[index];
    
    // Apply snapping to intersection points
    const snappedPoint = autoSnapEnabled
      ? findVertexSnapPoint(currentVertex)
      : null;
    
    // Use snapped position if available, otherwise use raw position
    const finalPoint = snappedPoint || currentVertex;
    
    // Now update the actual data point
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = finalPoint;

    // Re-render to show final position and any aligned vertices
    // Notify that perimeter changed
    onPerimeterUpdate(newVertices, true, previousVertices); // Save action for undo
    
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

  // Handle double-click to close custom shape or add perimeter vertex
  const handleStageDoubleClick = (e) => {
    // IMPORTANT: Only respond to LEFT double-click (button 0)
    if (e.evt && e.evt.button !== 0) return;

    // Line tool: a double click finishes the line
    if (lineToolActive && currentMeasurementLine && currentMeasurementLine.start) {
      const stage = e.target.getStage();
      if (!stage) return;
      const finalPoint = getCanvasCoordinates(stage);
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
    
    const clickPoint = getCanvasCoordinates(stage);
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



  // Helper function to calculate distance from point to line segment
  const pointToLineDistance = (point, lineStart, lineEnd) => {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) {
      // Line segment is a point
      const dpx = point.x - lineStart.x;
      const dpy = point.y - lineStart.y;
      return Math.sqrt(dpx * dpx + dpy * dpy);
    }
    
    // Calculate projection of point onto line
    const t = Math.max(0, Math.min(1, 
      ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared
    ));
    
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    
    const dpx = point.x - projX;
    const dpy = point.y - projY;
    
    return Math.sqrt(dpx * dpx + dpy * dpy);
  };

  // Handle global mouse move for dragging
  const handleStageMouseMove = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const mousePoint = getCanvasCoordinates(stage);
    if (!mousePoint) return;
    
    setCurrentMousePos(mousePoint);
    
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
    if (draggingRoom && roomStart) {
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;
      
      const movedOverlay = {
        x1: roomOverlay.x1 + deltaX,
        y1: roomOverlay.y1 + deltaY,
        x2: roomOverlay.x2 + deltaX,
        y2: roomOverlay.y2 + deltaY
      };
      
      const newOverlay = autoSnapEnabled ? snapRoomOverlayPosition(movedOverlay) : movedOverlay;
      onRoomOverlayUpdate(newOverlay, false); // Don't save action during drag
      setRoomStart(mousePoint);
      return;
    }
    
    // Handle room corner dragging with local edge scans while resizing.
    if (draggingRoomCorner && roomOverlay) {
      const newOverlay = { ...roomOverlay };
      
      if (draggingRoomCorner === 'tl') {
        const snappedX = findVerticalSnap(mousePoint.x, roomOverlay.y2, mousePoint.y);
        const snappedY = findHorizontalSnap(mousePoint.y, mousePoint.x, roomOverlay.x2);
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        const snappedX = findVerticalSnap(mousePoint.x, roomOverlay.y2, mousePoint.y);
        const snappedY = findHorizontalSnap(mousePoint.y, roomOverlay.x1, mousePoint.x);
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        const snappedX = findVerticalSnap(mousePoint.x, roomOverlay.y1, mousePoint.y);
        const snappedY = findHorizontalSnap(mousePoint.y, mousePoint.x, roomOverlay.x2);
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        const snappedX = findVerticalSnap(mousePoint.x, roomOverlay.y1, mousePoint.y);
        const snappedY = findHorizontalSnap(mousePoint.y, roomOverlay.x1, mousePoint.x);
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
    if (draggingRoom) {
      // Check if room position changed and save for undo
      if (lastRoomDragStartRef.current && roomOverlay) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== roomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== roomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== roomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== roomOverlay.y2;
        
        if (changed) {
          // Trigger a final update with saveAction=true to record the change
          // Pass the previous state explicitly
          onRoomOverlayUpdate(roomOverlay, true, lastRoomDragStartRef.current);
        }
      }
      setDraggingRoom(false);
      setRoomStart(null);
      lastRoomDragStartRef.current = null;
    }
    if (draggingRoomCorner) {
      // Check if room size changed and save for undo
      if (lastRoomDragStartRef.current && roomOverlay) {
        const changed = 
          lastRoomDragStartRef.current.x1 !== roomOverlay.x1 ||
          lastRoomDragStartRef.current.y1 !== roomOverlay.y1 ||
          lastRoomDragStartRef.current.x2 !== roomOverlay.x2 ||
          lastRoomDragStartRef.current.y2 !== roomOverlay.y2;
        
        if (changed) {
          // Trigger a final update with saveAction=true to record the change
          // Pass the previous state explicitly
          onRoomOverlayUpdate(roomOverlay, true, lastRoomDragStartRef.current);
        }
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

  // Handle stage click for manual entry mode, line tool, draw area tool, or perimeter vertex placement
  const handleStageClick = (e) => {
    // Ignore right-clicks (button=2); those are handled by handleStageContextMenu
    if (e.evt.button === 2) {
      return;
    }

    // Ignore clicks that occurred after a drag operation
    if (isDraggingRef.current) {
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
        
        const clickPoint = getCanvasCoordinates(stage);
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
        
        const clickPoint = getCanvasCoordinates(stage);
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
        const clickPoint = getCanvasCoordinates(stage);
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
        const clickPoint = getCanvasCoordinates(stage);
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
  
  // Handle right click for undo/redo functionality.
  // Single right-click = undo, double right-click = redo.
  // Exception: if the line tool is active and a line is in progress, right-click cancels it.
  const handleStageContextMenu = (e) => {
    e.evt.preventDefault();

    if (lineToolActive && currentMeasurementLine && onMeasurementLineUpdate) {
      onMeasurementLineUpdate(null);
      return;
    }

    if (rightClickTimeoutRef.current) {
      clearTimeout(rightClickTimeoutRef.current);
      rightClickTimeoutRef.current = null;
      if (onRedo) {
        onRedo();
      }
      return;
    }

    rightClickTimeoutRef.current = setTimeout(() => {
      if (onUndo) {
        onUndo();
      }
      rightClickTimeoutRef.current = null;
    }, 220);
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
      if (rightClickTimeoutRef.current) {
        clearTimeout(rightClickTimeoutRef.current);
      }
    };
  }, []);

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
    perimeterVertices,
    onClosePerimeter,
    drawAreaActive,
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
        <div className="absolute inset-0 bg-chrome-900/60 backdrop-blur-sm flex items-center justify-center z-10">
          <div className="bg-chrome-800 border border-chrome-700 rounded-lg px-5 py-3.5 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent/30 border-t-accent"></div>
              <span className="text-sm text-slate-200 font-medium">Processing image&hellip;</span>
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
          draggable={!draggingRoom && !draggingRoomCorner && draggingVertex === null && !isZoomingRef.current && !manualEntryMode && !(roomOverlay && !perimeterOverlay)}
          onDragStart={handleStageDragStart}
          onDragEnd={handleStageDragEnd}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onContextMenu={handleStageContextMenu}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onDblClick={handleStageDoubleClick}
          onDblTap={handleStageDoubleClick}
          style={{ cursor: 'default' }}
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

            {/* Perimeter Overlay - Line only (lowest z-index for overlays) */}
            {perimeterOverlay && perimeterOverlay.vertices && (
              <Line
                points={perimeterOverlay.vertices.flatMap(v => [v.x, v.y])}
                stroke="#BD93F9"
                strokeWidth={2 / scale}
                closed={true}
                fill="rgba(189, 147, 249, 0.15)"
                onDblClick={handleStageDoubleClick}
                onDblTap={handleStageDoubleClick}
              />
            )}
            
            {/* Room Overlay - Render above perimeter line but below perimeter vertices */}
            {roomOverlay && (
              <>
                {Array.isArray(roomOverlay.polygon) && roomOverlay.polygon.length > 2 && (
                  <Line
                    points={roomOverlay.polygon.flatMap((point) => [point.x, point.y])}
                    closed
                    stroke="rgba(80, 250, 123, 0.85)"
                    strokeWidth={1.5 / scale}
                    fill="rgba(80, 250, 123, 0.1)"
                    listening={false}
                  />
                )}
                <Rect
                  x={Math.min(roomOverlay.x1, roomOverlay.x2)}
                  y={Math.min(roomOverlay.y1, roomOverlay.y2)}
                  width={Math.abs(roomOverlay.x2 - roomOverlay.x1)}
                  height={Math.abs(roomOverlay.y2 - roomOverlay.y1)}
                  stroke="#50FA7B"
                  strokeWidth={2 / scale}
                  fill="rgba(80, 250, 123, 0.15)"
                  onMouseDown={handleRoomMouseDown}
                />
                
                {/* Room Corner Handles */}
                {[
                  { x: roomOverlay.x1, y: roomOverlay.y1, corner: 'tl' },
                  { x: roomOverlay.x2, y: roomOverlay.y1, corner: 'tr' },
                  { x: roomOverlay.x1, y: roomOverlay.y2, corner: 'bl' },
                  { x: roomOverlay.x2, y: roomOverlay.y2, corner: 'br' }
                ].map((handle, i) => {
                  return (
                    <Circle
                      key={i}
                      x={handle.x}
                      y={handle.y}
                      radius={5 / scale}
                      fill="#50FA7B"
                      stroke="#fff"
                      strokeWidth={1.5 / scale}
                      onMouseDown={(e) => handleRoomCornerMouseDown(handle.corner, e)}
                    />
                  );
                })}
                {debugDetection && typeof roomOverlay.confidence === 'number' && (
                  <Text
                    x={Math.min(roomOverlay.x1, roomOverlay.x2)}
                    y={Math.min(roomOverlay.y1, roomOverlay.y2) - 16 / scale}
                    text={`Room confidence ${Math.round(roomOverlay.confidence * 100)}%`}
                    fontSize={11 / scale}
                    fill="#50FA7B"
                    fontStyle="bold"
                    listening={false}
                  />
                )}
              </>
            )}

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
            
            {/* Perimeter Vertices - Render last (highest z-index for interaction priority) */}
            {perimeterOverlay && perimeterOverlay.vertices && (
              <>
                {perimeterOverlay.vertices.map((vertex, i) => (
                  <React.Fragment key={i}>
                    <Circle
                      x={vertex.x}
                      y={vertex.y}
                      radius={5 / scale}
                      fill="#BD93F9"
                      stroke="#fff"
                      strokeWidth={1.5 / scale}
                      draggable={!lineToolActive && !drawAreaActive}
                      onDragStart={() => handleVertexDragStart(i)}
                      onDragMove={(e) => handleVertexDrag(i, e)}
                      onDragEnd={() => handleVertexDragEnd(i)}
                      onContextMenu={(e) => {
                        e.evt.preventDefault();
                        e.cancelBubble = true;
                        if (onDeletePerimeterVertex) onDeletePerimeterVertex(i);
                      }}
                    />
                  </React.Fragment>
                ))}

                {/* Side Length Labels */}
                {showSideLengths && pixelsPerFoot && perimeterOverlay.vertices.map((vertex, i) => {
                  const nextVertex = perimeterOverlay.vertices[(i + 1) % perimeterOverlay.vertices.length];
                  
                  // Calculate side length in pixels
                  const dx = nextVertex.x - vertex.x;
                  const dy = nextVertex.y - vertex.y;
                  const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
                  
                  // Convert to feet
                  const lengthInFeet = lengthInPixels * pixelsPerFoot;
                  
                  // Format based on unit preference
                  const formattedLength = formatLength(lengthInFeet, unit);
                  
                  // Calculate midpoint for label placement
                  const midX = (vertex.x + nextVertex.x) / 2;
                  const midY = (vertex.y + nextVertex.y) / 2;
                  
                  // Calculate offset perpendicular to the line (for label positioning)
                  const angle = Math.atan2(dy, dx);
                  const sideSign = i % 2 === 0 ? 1 : -1;
                  const shortEdge = lengthInPixels < 48;
                  const offsetDistance =
                    sideSign * (shortEdge ? 12 / scale : 9 / scale);
                  const offsetX = Math.sin(angle) * offsetDistance;
                  const offsetY = -Math.cos(angle) * offsetDistance;
                  
                  const padX = 4 / scale;
                  const minW = 26 / scale;
                  const maxWByEdge = Math.max(minW, lengthInPixels * 0.9);
                  const idealFs = 9 / scale;
                  const minFs = 6.25 / scale;
                  const widthForFs = (fs) => formattedLength.length * fs * 0.55 + padX * 2;
                  let fontSize = idealFs;
                  if (widthForFs(fontSize) > maxWByEdge) {
                    fontSize = Math.max(minFs, (maxWByEdge - padX * 2) / Math.max(0.5, formattedLength.length * 0.55));
                  }
                  const labelWidth = Math.min(Math.max(minW, widthForFs(fontSize)), maxWByEdge);
                  const labelHeight = Math.max(13 / scale, fontSize * 1.35);
                  const cornerR = 4 / scale;

                  return (
                    <React.Fragment key={`label-${i}`}>
                      <Rect
                        x={midX + offsetX - labelWidth / 2}
                        y={midY + offsetY - labelHeight / 2}
                        width={labelWidth}
                        height={labelHeight}
                        fill="rgba(40, 42, 54, 0.92)"
                        strokeWidth={0}
                        cornerRadius={cornerR}
                      />
                      <Text
                        x={midX + offsetX}
                        y={midY + offsetY}
                        text={formattedLength}
                        fontSize={fontSize}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontStyle="500"
                        align="center"
                        verticalAlign="middle"
                        offsetX={labelWidth / 2}
                        offsetY={fontSize * 0.36}
                      />
                    </React.Fragment>
                  );
                })}
              </>
            )}
            
            {/* Manual Mode - Detected Dimensions Highlights */}
            {mode === 'manual' && detectedDimensions && detectedDimensions.length > 0 && (
              <>
                {detectedDimensions.map((dim, i) => {
                  const cx = dim.bbox.x + dim.bbox.width / 2;
                  const cy = dim.bbox.y + dim.bbox.height / 2;
                  const labelText = `${formatLength(dim.width, unit)} × ${formatLength(dim.height, unit)}`;
                  const fs = 12 / scale;
                  const padX = 7 / scale;
                  const padY = 3.5 / scale;
                  const labelW = measureTextWidth(labelText, fs) + padX * 2;
                  const labelH = fs + padY * 2;
                  const cornerR = labelH / 2;
                  const gap = 5 / scale;
                  const tailH = 5 / scale;
                  // Position pill above the bbox; clamp so it doesn't go off the top edge
                  const labelY = Math.max(0, dim.bbox.y - labelH - tailH - gap);
                  const labelX = cx - labelW / 2;
                  const dotR = Math.max(OCR_DOT_MIN_RADIUS, OCR_DOT_BASE_RADIUS / scale);
                  const handleClick = () => onDimensionSelect && onDimensionSelect(dim);
                  const handlePointerEnter = () => { if (stageRef.current) stageRef.current.container().style.cursor = 'pointer'; };
                  const handlePointerLeave = () => { if (stageRef.current) stageRef.current.container().style.cursor = 'default'; };

                  return (
                    <React.Fragment key={i}>
                      {/* Small dot marker at OCR text center */}
                      <Circle
                        x={cx}
                        y={cy}
                        radius={dotR}
                        fill="#FFB86C"
                        onClick={handleClick}
                        onTap={handleClick}
                        onMouseEnter={handlePointerEnter}
                        onMouseLeave={handlePointerLeave}
                      />
                      {/* Connector line from dot to pill */}
                      <Line
                        points={[cx, cy - dotR, cx, labelY + labelH]}
                        stroke="#FFB86C"
                        strokeWidth={1.5 / scale}
                        opacity={0.6}
                        listening={false}
                      />
                      {/* Floating pill badge */}
                      <Rect
                        x={labelX}
                        y={labelY}
                        width={labelW}
                        height={labelH}
                        fill="#FFB86C"
                        cornerRadius={cornerR}
                        onClick={handleClick}
                        onTap={handleClick}
                        onMouseEnter={handlePointerEnter}
                        onMouseLeave={handlePointerLeave}
                      />
                      <Text
                        x={labelX + padX}
                        y={labelY + padY}
                        text={labelText}
                        fontSize={fs}
                        fill="#ffffff"
                        fontFamily={OCR_PILL_FONT_FAMILY}
                        fontStyle={OCR_PILL_FONT_STYLE}
                        listening={false}
                      />
                    </React.Fragment>
                  );
                })}
              </>
            )}
            
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
            
            {/* Perimeter Vertex Placement Mode - Instructions and temporary vertices */}
            {roomOverlay && !perimeterOverlay && perimeterVertices && perimeterVertices.length < 3 && !lineToolActive && !drawAreaActive && !manualEntryMode && (
              <>
                {/* Instructions */}
                <Text
                  x={10}
                  y={10}
                  text={`Click to add perimeter vertices (${perimeterVertices.length}/3) | Right-click undo / Ctrl+Right-click redo`}
                  fontSize={16 / scale}
                  fill="#F1FA8C"
                  fontStyle="bold"
                />
                
                {/* Temporary vertices */}
                {perimeterVertices.map((vertex, i) => (
                  <React.Fragment key={`temp-vertex-${i}`}>
                    <Circle
                      x={vertex.x}
                      y={vertex.y}
                      radius={5 / scale}
                      fill="#F1FA8C"
                      stroke="#fff"
                      strokeWidth={1.5 / scale}
                    />
                    
                    {/* Preview line from previous vertex */}
                    {i > 0 && (
                      <Line
                        points={[
                          perimeterVertices[i - 1].x,
                          perimeterVertices[i - 1].y,
                          vertex.x,
                          vertex.y
                        ]}
                        stroke="#F1FA8C"
                        strokeWidth={2 / scale}
                        dash={[10 / scale, 5 / scale]}
                      />
                    )}
                  </React.Fragment>
                ))}
                
                {/* Preview line from last vertex to mouse */}
                {perimeterVertices.length > 0 && currentMousePos && (
                  <Line
                    points={[
                      perimeterVertices[perimeterVertices.length - 1].x,
                      perimeterVertices[perimeterVertices.length - 1].y,
                      currentMousePos.x,
                      currentMousePos.y
                    ]}
                    stroke="#F1FA8C"
                    strokeWidth={2 / scale}
                    dash={[10 / scale, 5 / scale]}
                    opacity={0.5}
                  />
                )}
              </>
            )}
            
          </Layer>

          {/* Measurement Lines */}
          {measurementLines && measurementLines.length > 0 && (
            <Layer>
              {measurementLines.map((line, index) => {
                const layout = getMeasurementLineLayout(line, scale, pixelsPerFoot, unit);
                const colors = LINE_COLORS[index % LINE_COLORS.length];
                const strokeColor = selectedMeasurementLineIndex === index ? colors.selected : colors.normal;
                const strokeW = (selectedMeasurementLineIndex === index ? 3 : 2) / scale;
                return (
                <Group
                  key={`line-${index}`}
                  x={0}
                  y={0}
                  draggable
                  onClick={(e) => handleMeasurementLineSelect(index, e)}
                  onTap={(e) => handleMeasurementLineSelect(index, e)}
                  onDragStart={(e) => handleMeasurementLineSelect(index, e)}
                  onDragEnd={(e) => handleMeasurementLineDragEnd(index, e)}
                  onContextMenu={(e) => {
                    e.evt.preventDefault();
                    e.cancelBubble = true;
                    if (onMeasurementLinesChange) {
                      onMeasurementLinesChange(measurementLines.filter((_, i) => i !== index));
                    }
                  }}
                >
                  <Line
                    name="measurement-line"
                    points={layout.line1Points}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    hitStrokeWidth={16 / scale}
                  />
                  <Line
                    name="measurement-line"
                    points={layout.line2Points}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    hitStrokeWidth={16 / scale}
                  />
                  <Text
                    name="measurement-line"
                    x={layout.labelX}
                    y={layout.labelY}
                    text={layout.textStr}
                    fontSize={layout.fontSize}
                    fill={strokeColor}
                    fontStyle="bold"
                    offsetX={layout.approxTextWidth / 2}
                    offsetY={layout.approxTextHeight / 2}
                  />
                </Group>
                );
              })}
            </Layer>
          )}

          {/* Measurement Line Preview */}
          {lineToolActive && currentMeasurementLine && (() => {
            const previewColors = LINE_COLORS[measurementLines.length % LINE_COLORS.length];
            const previewColor = previewColors.normal;
            const dx = currentMeasurementLine.end.x - currentMeasurementLine.start.x;
            const dy = currentMeasurementLine.end.y - currentMeasurementLine.start.y;
            const minPreviewLength = 1; // pixels; suppress label for near-zero-length lines
            const hasLength = Math.sqrt(dx * dx + dy * dy) > minPreviewLength;
            const previewLayout = hasLength && pixelsPerFoot
              ? getMeasurementLineLayout(currentMeasurementLine, scale, pixelsPerFoot, unit)
              : null;
            return (
              <Layer>
                <Line
                  points={[
                    currentMeasurementLine.start.x,
                    currentMeasurementLine.start.y,
                    currentMeasurementLine.end.x,
                    currentMeasurementLine.end.y
                  ]}
                  stroke={previewColor}
                  strokeWidth={2 / scale}
                  dash={[6 / scale, 3 / scale]}
                  opacity={0.7}
                />
                {previewLayout && (
                  <Text
                    x={previewLayout.labelX}
                    y={previewLayout.labelY}
                    text={previewLayout.textStr}
                    fontSize={previewLayout.fontSize}
                    fill={previewColor}
                    fontStyle="bold"
                    offsetX={previewLayout.approxTextWidth / 2}
                    offsetY={previewLayout.approxTextHeight / 2}
                    opacity={0.9}
                  />
                )}
              </Layer>
            );
          })()}
          
          {/* Custom Areas */}
          {customShapes && customShapes.length > 0 && (
            <Layer>
              {customShapes.map((shape, shapeIndex) => (
                <Group
                  key={`shape-${shapeIndex}`}
                  x={0}
                  y={0}
                  draggable={shape.closed}
                  onClick={(e) => handleCustomShapeSelect(shapeIndex, e)}
                  onTap={(e) => handleCustomShapeSelect(shapeIndex, e)}
                  onDragStart={(e) => handleCustomShapeSelect(shapeIndex, e)}
                  onDragEnd={(e) => handleCustomShapeDragEnd(shapeIndex, e)}
                >
                  <Line
                    name="custom-shape"
                    points={shape.vertices.flatMap(v => [v.x, v.y])}
                    closed={shape.closed}
                    fill={shape.closed ? 'rgba(139, 233, 253, 0.15)' : 'transparent'}
                    stroke={selectedCustomShapeIndex === shapeIndex ? '#A8F0FF' : '#8BE9FD'}
                    strokeWidth={(selectedCustomShapeIndex === shapeIndex ? 3 : 2) / scale}
                  />
                  {shape.closed && shape.vertices.map((vertex, vertexIndex) => (
                    <Circle
                      key={`shape-${shapeIndex}-vertex-${vertexIndex}`}
                      name="custom-shape"
                      x={vertex.x}
                      y={vertex.y}
                      radius={5 / scale}
                      fill={selectedCustomShapeIndex === shapeIndex ? '#A8F0FF' : '#8BE9FD'}
                      stroke="#6272A4"
                      strokeWidth={1 / scale}
                    />
                  ))}
                  {shape.closed && shape.vertices.length >= 3 && (() => {
                    const centroid = getCentroid(shape.vertices);
                    const areaValue = calculateArea(shape.vertices, pixelsPerFoot);
                    const areaText = areaValue >= 1
                      ? `${areaValue.toFixed(1)} sq ft`
                      : `${(areaValue * 144).toFixed(0)} sq in`;
                    return (
                      <Text
                        name="custom-shape"
                        x={centroid.x}
                        y={centroid.y}
                        text={areaText}
                        fontSize={14 / scale}
                        fill={selectedCustomShapeIndex === shapeIndex ? '#A8F0FF' : '#8BE9FD'}
                        fontStyle="bold"
                        offsetX={0}
                        offsetY={0}
                        align="center"
                        ref={(node) => {
                          if (node) {
                            node.offsetX(node.width() / 2);
                            node.offsetY(node.height() / 2);
                          }
                        }}
                      />
                    );
                  })()}
                </Group>
              ))}
            </Layer>
          )}
          
          {/* Custom Shape (Draw Area Tool) Preview */}
          {drawAreaActive && currentCustomShape && currentMousePos && (
            <Layer>
              <Line
                points={currentCustomShape.vertices.flatMap(v => [v.x, v.y]).concat(currentCustomShape.vertices.length > 0 ? [currentMousePos.x, currentMousePos.y] : [])}
                closed={false}
                stroke="#8BE9FD"
                strokeWidth={2 / scale}
                dash={[6 / scale, 3 / scale]}
              />
              {currentCustomShape.vertices.map((vertex, index) => (
                <Circle
                  key={`current-shape-vertex-${index}`}
                  x={vertex.x}
                  y={vertex.y}
                  radius={5 / scale}
                  fill={index === 0 ? '#FFB86C' : '#8BE9FD'} // Highlight first vertex to indicate closing point
                  stroke="#6272A4"
                  strokeWidth={1 / scale}
                />
              ))}
            </Layer>
          )}
        </Stage>
      )}
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;
