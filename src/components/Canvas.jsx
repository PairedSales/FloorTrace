import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
import { formatLength } from '../utils/unitConverter';
// Stub implementations for snapping functions (utilities don't exist yet)
// eslint-disable-next-line no-unused-vars
const findNearestIntersection = (_point, _snapPoints, _threshold) => {
  // Snapping disabled until utilities are implemented
  return null;
};

// eslint-disable-next-line no-unused-vars
const applySecondaryAlignment = (_vertices, _index, _finalPoint, _threshold) => {
  // Secondary alignment disabled until utilities are implemented
  return _vertices;
};

const SNAP_TO_INTERSECTION_DISTANCE = 10;
const SECONDARY_ALIGNMENT_DISTANCE = 20;

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
  drawAreaActive,
  customShapes,
  currentCustomShape,
  onCustomShapeUpdate,
  onAddCustomShape,
  isMobile,
  lineData,
  cornerPoints,
  perimeterVertices,
  onAddPerimeterVertex,
  onClosePerimeter, // New prop to handle closing the shape
  onUndoRedo
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
  const [draggingCustomVertex, setDraggingCustomVertex] = useState(null); // { shapeIndex, vertexIndex }
  const [currentMousePos, setCurrentMousePos] = useState(null);
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  const rightClickTimeoutRef = useRef(null);
  const rightClickCountRef = useRef(0);
  const lastDraggedVertexRef = useRef(null); // Track last dragged vertex index
  const lastDragStartPosRef = useRef(null); // Track starting position before drag
  const lastRoomDragStartRef = useRef(null); // Track room overlay before move/resize
  const isDraggingRef = useRef(false); // Track if any drag operation is in progress
  const dragStartPosRef = useRef(null); // Track initial mouse position to detect drag vs click
  const visualSnapPositionRef = useRef(null); // Stores the visual snap position during drag (like .NET's _visualSnapPosition)
  
  // Mobile touch gesture state
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [touchStartPos, setTouchStartPos] = useState(null);
  const [showDeleteOption, setShowDeleteOption] = useState(null); // vertex index to show delete option
  const touchMoveThreshold = 10; // pixels to distinguish tap from drag
  const longPressDelay = 500; // milliseconds for long press

  // Use corner points for snapping, extract lines for room overlay snapping
  const { horizontalLines, verticalLines, snapPoints } = useMemo(() => {
    // Extract line positions for room overlay edge snapping
    const hLines = lineData?.horizontal ? lineData.horizontal.map(line => line.center) : [];
    const vLines = lineData?.vertical ? lineData.vertical.map(line => line.center) : [];
    
    // Use corner points for vertex snapping
    const corners = cornerPoints || [];
    
    if (corners.length > 0) {
      console.log(`Snapping: Using ${corners.length} detected corner points`);
    } else {
      console.log('Snapping: No corner points available');
    }

    return {
      horizontalLines: hLines,
      verticalLines: vLines,
      snapPoints: corners
    };
  }, [lineData, cornerPoints]);

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
    
    // Apply snapping to intersection points for visual feedback
    const snappedPoint = findNearestIntersection(
      canvasPos,
      snapPoints,
      SNAP_TO_INTERSECTION_DISTANCE
    );
    
    // Use snapped position if available, otherwise use raw position
    const visualPoint = snappedPoint || canvasPos;
    
    // Store the snap position for use in MouseUp (drag end)
    visualSnapPositionRef.current = snappedPoint;
    
    // Update only the visual elements, not the actual data
    // In .NET this updates Canvas.SetLeft/SetTop and polygon.Points
    // In React-Konva, we update the state which re-renders, but mark saveAction=false
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = { x: visualPoint.x, y: visualPoint.y };
    
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
    const snappedPoint = findNearestIntersection(
      currentVertex,
      snapPoints,
      SNAP_TO_INTERSECTION_DISTANCE
    );
    
    // Use snapped position if available, otherwise use raw position
    const finalPoint = snappedPoint || currentVertex;
    
    // Now update the actual data point
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = finalPoint;
    
    // Apply secondary alignment to nearby vertices if snapped
    if (snappedPoint) {
      applySecondaryAlignment(
        newVertices,
        index,
        finalPoint,
        SECONDARY_ALIGNMENT_DISTANCE
      );
    }
    
    // Re-render to show final position and any aligned vertices
    // Notify that perimeter changed
    onPerimeterUpdate(newVertices, true, previousVertices); // Save action for undo
    
    // Clean up
    setDraggingVertex(null);
    visualSnapPositionRef.current = null;
  };

  // Delete perimeter vertex (for mobile)
  const deletePerimeterVertex = (index) => {
    if (!perimeterOverlay || perimeterOverlay.vertices.length <= 3) return;
    const newVertices = perimeterOverlay.vertices.filter((_, i) => i !== index);
    onPerimeterUpdate(newVertices);
    setShowDeleteOption(null);
  };

  // Handle custom shape vertex dragging
  const handleCustomVertexDragStart = (shapeIndex, vertexIndex) => {
    if (!customShapes[shapeIndex] || !customShapes[shapeIndex].closed) return;
    setDraggingCustomVertex({ shapeIndex, vertexIndex });
  };

  const handleCustomVertexDrag = (e) => {
    if (!draggingCustomVertex) return;
    const { shapeIndex, vertexIndex } = draggingCustomVertex;

    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (!canvasPos) return;

    const newShapes = [...customShapes];
    const newVertices = [...newShapes[shapeIndex].vertices];
    newVertices[vertexIndex] = canvasPos;
    newShapes[shapeIndex] = { ...newShapes[shapeIndex], vertices: newVertices };
    // This should be a new prop, like onUpdateCustomShapes
    // For now, let's assume onAddCustomShape can handle updates by replacing the whole array
  };

  const handleCustomVertexDragEnd = () => {
    setDraggingCustomVertex(null);
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
    const snappedPoint = findNearestIntersection(
      clickPoint,
      snapPoints,
      SNAP_TO_INTERSECTION_DISTANCE
    );
    
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
    let newVertices = [...vertices];
    newVertices.splice(closestEdgeIndex + 1, 0, finalPoint);
    
    // Apply secondary alignment to nearby vertices if snapped
    if (snappedPoint) {
      applySecondaryAlignment(
        newVertices,
        closestEdgeIndex + 1,
        finalPoint,
        SECONDARY_ALIGNMENT_DISTANCE
      );
    }
    
    onPerimeterUpdate(newVertices, true); // Save action for undo
  };

  // Helper function to snap a value to the nearest line within threshold
  const snapToNearestLine = (value, lines, threshold) => {
    if (!lines || lines.length === 0) {
      return null;
    }
    
    let nearestLine = null;
    let minDistance = Number.MAX_VALUE;
    
    for (const line of lines) {
      const distance = Math.abs(line - value);
      if (distance < minDistance && distance <= threshold) {
        minDistance = distance;
        nearestLine = line;
      }
    }
    
    return nearestLine;
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
    
    // Handle room overlay dragging
    if (draggingRoom && roomStart) {
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;
      
      const newOverlay = {
        x1: roomOverlay.x1 + deltaX,
        y1: roomOverlay.y1 + deltaY,
        x2: roomOverlay.x2 + deltaX,
        y2: roomOverlay.y2 + deltaY
      };
      
      onRoomOverlayUpdate(newOverlay, false); // Don't save action during drag
      setRoomStart(mousePoint);
      return;
    }
    
    // Handle room corner dragging with snapping
    if (draggingRoomCorner && roomOverlay) {
      const snapThreshold = 5.0; // pixels, matching .NET implementation
      const newOverlay = { ...roomOverlay };
      
      if (draggingRoomCorner === 'tl') {
        // Snap left edge to vertical lines
        const snappedX = snapToNearestLine(mousePoint.x, verticalLines, snapThreshold);
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        
        // Snap top edge to horizontal lines
        const snappedY = snapToNearestLine(mousePoint.y, horizontalLines, snapThreshold);
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        // Snap right edge to vertical lines
        const snappedX = snapToNearestLine(mousePoint.x, verticalLines, snapThreshold);
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        
        // Snap top edge to horizontal lines
        const snappedY = snapToNearestLine(mousePoint.y, horizontalLines, snapThreshold);
        newOverlay.y1 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        // Snap left edge to vertical lines
        const snappedX = snapToNearestLine(mousePoint.x, verticalLines, snapThreshold);
        newOverlay.x1 = snappedX !== null ? snappedX : mousePoint.x;
        
        // Snap bottom edge to horizontal lines
        const snappedY = snapToNearestLine(mousePoint.y, horizontalLines, snapThreshold);
        newOverlay.y2 = snappedY !== null ? snappedY : mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        // Snap right edge to vertical lines
        const snappedX = snapToNearestLine(mousePoint.x, verticalLines, snapThreshold);
        newOverlay.x2 = snappedX !== null ? snappedX : mousePoint.x;
        
        // Snap bottom edge to horizontal lines
        const snappedY = snapToNearestLine(mousePoint.y, horizontalLines, snapThreshold);
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
    // Ignore clicks that occurred after a drag operation
    if (isDraggingRef.current) {
      return;
    }
    
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
        const snappedPoint = findNearestIntersection(
          clickPoint,
          snapPoints,
          SNAP_TO_INTERSECTION_DISTANCE
        );
        
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
  
  // Handle right click for undo/redo functionality - ONLY undo/redo, nothing else
  const handleStageContextMenu = (e) => {
    // ALWAYS prevent default context menu
    e.evt.preventDefault();
    
    // Increment right-click count
    rightClickCountRef.current += 1;
    
    // Clear any existing timeout
    if (rightClickTimeoutRef.current) {
      clearTimeout(rightClickTimeoutRef.current);
    }
    
    // Set a timeout to reset right-click count
    rightClickTimeoutRef.current = setTimeout(() => {
      rightClickCountRef.current = 0;
    }, 300); // 300ms window for double right-click detection
    
    // If this is a double right-click, do nothing
    if (rightClickCountRef.current === 2) {
      rightClickCountRef.current = 0;
      return;
    }
    
    // Wait a bit to see if a second right-click comes
    setTimeout(() => {
      if (rightClickCountRef.current !== 1) return; // A double right-click happened, skip
      
      // Single right-click - ONLY perform undo/redo (works anywhere, including on vertices)
      if (onUndoRedo) {
        onUndoRedo();
      }
    }, 50); // Wait 50ms to distinguish single from double right-click
  };
  

  // Mobile touch handlers
  const handleTouchStart = (e) => {
    if (!isMobile) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const canvasPos = getCanvasCoordinates(stage);
    
    setTouchStartPos(canvasPos);
    
    // Check if touching a vertex (for long press delete)
    const targetType = e.target.getType();
    
    // Dismiss delete option if tapping elsewhere (not on delete button or vertex)
    if (showDeleteOption !== null && targetType !== 'Circle' && targetType !== 'Text') {
      setShowDeleteOption(null);
      return;
    }
    
    if (targetType === 'Circle' && perimeterOverlay) {
      // Find which vertex was touched
      const vertices = perimeterOverlay.vertices;
      for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        const dx = canvasPos.x - vertex.x;
        const dy = canvasPos.y - vertex.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 15 / scaleRef.current) {
          // Start long press timer for delete
          const timer = setTimeout(() => {
            setShowDeleteOption(i);
          }, longPressDelay);
          setLongPressTimer(timer);
          return;
        }
      }
    }
    
    // Check if touching canvas/image for long press to add vertex
    if ((targetType === 'Stage' || targetType === 'Image' || targetType === 'Line') && 
        perimeterOverlay && !lineToolActive && !drawAreaActive && !manualEntryMode) {
      const timer = setTimeout(() => {
        // Apply snapping to corner points
        const snappedPoint = findNearestIntersection(
          canvasPos,
          snapPoints,
          SNAP_TO_INTERSECTION_DISTANCE
        );
        
        // Use snapped position if available, otherwise use raw position
        const finalPoint = snappedPoint || canvasPos;
        
        // Add vertex at touch position
        const vertices = perimeterOverlay.vertices;
        let closestEdgeIndex = 0;
        let minDistance = Infinity;
        
        for (let i = 0; i < vertices.length; i++) {
          const v1 = vertices[i];
          const v2 = vertices[(i + 1) % vertices.length];
          const distance = pointToLineDistance(canvasPos, v1, v2);
          
          if (distance < minDistance) {
            minDistance = distance;
            closestEdgeIndex = i;
          }
        }
        
        let newVertices = [...vertices];
        newVertices.splice(closestEdgeIndex + 1, 0, finalPoint);
        
        // Apply secondary alignment to nearby vertices if snapped
        if (snappedPoint) {
          applySecondaryAlignment(
            newVertices,
            closestEdgeIndex + 1,
            finalPoint,
            SECONDARY_ALIGNMENT_DISTANCE
          );
        }
        
        onPerimeterUpdate(newVertices);
        
        // Provide haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, longPressDelay);
      setLongPressTimer(timer);
    }
  };
  
  const handleTouchMove = (e) => {
    if (!isMobile) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const canvasPos = getCanvasCoordinates(stage);
    
    // Cancel long press if moved too much
    if (longPressTimer && touchStartPos) {
      const dx = canvasPos.x - touchStartPos.x;
      const dy = canvasPos.y - touchStartPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > touchMoveThreshold / scaleRef.current) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
      }
    }
  };
  
  const handleTouchEnd = () => {
    if (!isMobile) return;
    
    // Clear long press timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    
    setTouchStartPos(null);
  };
  
  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }
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
  }, [longPressTimer]);

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
  }, [perimeterVertices, onClosePerimeter, drawAreaActive, currentCustomShape, onAddCustomShape, onCustomShapeUpdate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div ref={containerRef} className="absolute inset-0 bg-white" style={{ cursor: 'default' }}>
      {!image && !isProcessing && !isMobile && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-xl text-slate-600 font-medium">
              Paste or Load a Sketch Image to Get Started
            </p>
          </div>
        </div>
      )}
      
      {isProcessing && (
        <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
              <span className="text-slate-700 font-medium">Processing...</span>
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
          draggable={!draggingRoom && !draggingRoomCorner && draggingVertex === null && draggingCustomVertex === null && !isZoomingRef.current && !manualEntryMode && !lineToolActive && !drawAreaActive && !(roomOverlay && !perimeterOverlay)}
          onDragStart={handleStageDragStart}
          onDragEnd={handleStageDragEnd}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onContextMenu={handleStageContextMenu}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onDblClick={handleStageDoubleClick}
          onDblTap={handleStageDoubleClick}
          onTouchStart={isMobile ? handleTouchStart : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
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
                stroke="#6366f1"
                strokeWidth={2 / scale}
                closed={true}
                fill="rgba(99, 102, 241, 0.15)"
                onDblClick={handleStageDoubleClick}
                onDblTap={handleStageDoubleClick}
              />
            )}
            
            {/* Room Overlay - Render above perimeter line but below perimeter vertices */}
            {roomOverlay && (
              <>
                <Rect
                  x={Math.min(roomOverlay.x1, roomOverlay.x2)}
                  y={Math.min(roomOverlay.y1, roomOverlay.y2)}
                  width={Math.abs(roomOverlay.x2 - roomOverlay.x1)}
                  height={Math.abs(roomOverlay.y2 - roomOverlay.y1)}
                  stroke="#10b981"
                  strokeWidth={2 / scale}
                  fill="rgba(16, 185, 129, 0.15)"
                  onMouseDown={handleRoomMouseDown}
                  onTouchStart={isMobile ? handleRoomMouseDown : undefined}
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
                      radius={isMobile ? 10 / scale : 5 / scale}
                      fill="#10b981"
                      stroke="#fff"
                      strokeWidth={1.5 / scale}
                      onMouseDown={(e) => handleRoomCornerMouseDown(handle.corner, e)}
                      onTouchStart={isMobile ? (e) => handleRoomCornerMouseDown(handle.corner, e) : undefined}
                    />
                  );
                })}
              </>
            )}
            
            {/* Perimeter Vertices - Render last (highest z-index for interaction priority) */}
            {perimeterOverlay && perimeterOverlay.vertices && (
              <>
                {perimeterOverlay.vertices.map((vertex, i) => (
                  <React.Fragment key={i}>
                    <Circle
                      x={vertex.x}
                      y={vertex.y}
                      radius={isMobile ? 10 / scale : 5 / scale}
                      fill="#6366f1"
                      stroke="#fff"
                      strokeWidth={1.5 / scale}
                      draggable={!lineToolActive && !drawAreaActive}
                      onDragStart={() => handleVertexDragStart(i)}
                      onDragMove={(e) => handleVertexDrag(i, e)}
                      onDragEnd={() => handleVertexDragEnd(i)}
                    />
                    
                    {/* Delete button for mobile long press */}
                    {isMobile && showDeleteOption === i && (
                      <>
                        <Circle
                          x={vertex.x}
                          y={vertex.y - 30 / scale}
                          radius={15 / scale}
                          fill="#ef4444"
                          stroke="#fff"
                          strokeWidth={2 / scale}
                          onClick={() => deletePerimeterVertex(i)}
                          onTap={() => deletePerimeterVertex(i)}
                        />
                        <Text
                          x={vertex.x}
                          y={vertex.y - 30 / scale}
                          text="×"
                          fontSize={20 / scale}
                          fill="#fff"
                          fontStyle="bold"
                          align="center"
                          verticalAlign="middle"
                          offsetX={6 / scale}
                          offsetY={10 / scale}
                          onClick={() => deletePerimeterVertex(i)}
                          onTap={() => deletePerimeterVertex(i)}
                        />
                      </>
                    )}
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
                  const offsetDistance = 15 / scale; // Offset from the line
                  const offsetX = Math.sin(angle) * offsetDistance;
                  const offsetY = -Math.cos(angle) * offsetDistance;
                  
                  // Dynamic width based on text length
                  const labelWidth = Math.max(56, formattedLength.length * 6.5) / scale;
                  
                  return (
                    <React.Fragment key={`label-${i}`}>
                      {/* Modern minimalist background */}
                      <Rect
                        x={midX + offsetX - labelWidth / 2}
                        y={midY + offsetY - 11 / scale}
                        width={labelWidth}
                        height={22 / scale}
                        fill="rgba(17, 24, 39, 0.95)"
                        strokeWidth={0}
                        cornerRadius={6 / scale}
                      />
                      {/* Clean label text */}
                      <Text
                        x={midX + offsetX}
                        y={midY + offsetY}
                        text={formattedLength}
                        fontSize={11 / scale}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontStyle="500"
                        align="center"
                        verticalAlign="middle"
                        offsetX={labelWidth / 2}
                        offsetY={5.5 / scale}
                      />
                    </React.Fragment>
                  );
                })}
              </>
            )}
            
            {/* Manual Mode - Detected Dimensions Highlights */}
            {mode === 'manual' && detectedDimensions && detectedDimensions.length > 0 && (
              <>
                {detectedDimensions.map((dim, i) => (
                  <React.Fragment key={i}>
                    {/* Highlight box around detected dimension */}
                    <Rect
                      x={dim.bbox.x}
                      y={dim.bbox.y}
                      width={dim.bbox.width}
                      height={dim.bbox.height}
                      stroke="#8b5cf6"
                      strokeWidth={2 / scale}
                      fill="rgba(139, 92, 246, 0.15)"
                      onClick={() => onDimensionSelect && onDimensionSelect(dim)}
                      onTap={() => onDimensionSelect && onDimensionSelect(dim)}
                    />
                    {/* Label with dimension text */}
                    <Text
                      x={dim.bbox.x}
                      y={dim.bbox.y + dim.bbox.height + 5 / scale}
                      width={dim.bbox.width}
                      align="center"
                      text={`${formatLength(dim.width, unit)} x ${formatLength(dim.height, unit)}`}
                      fontSize={14 / scale}
                      fill="#8b5cf6"
                      fontStyle="bold"
                    />
                  </React.Fragment>
                ))}
              </>
            )}
            
            {/* Manual Entry Mode - Click to place overlays */}
            {manualEntryMode && (
              <Text
                x={10}
                y={10}
                text="Click on the canvas to place overlays"
                fontSize={16 / scale}
                fill="#3b82f6"
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
                  text={`Click to add perimeter vertices (${perimeterVertices.length}/3) | Right-click to undo`}
                  fontSize={16 / scale}
                  fill="#f59e0b"
                  fontStyle="bold"
                />
                
                {/* Temporary vertices */}
                {perimeterVertices.map((vertex, i) => (
                  <React.Fragment key={`temp-vertex-${i}`}>
                    <Circle
                      x={vertex.x}
                      y={vertex.y}
                      radius={isMobile ? 10 / scale : 5 / scale}
                      fill="#f59e0b"
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
                        stroke="#f59e0b"
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
                    stroke="#f59e0b"
                    strokeWidth={2 / scale}
                    dash={[10 / scale, 5 / scale]}
                    opacity={0.5}
                  />
                )}
              </>
            )}
            
            {/* Measurement Line Tool */}
            {lineToolActive && measurementLines && measurementLines.length > 0 && (
              <Layer>
                {measurementLines.map((line, index) => (
                  <React.Fragment key={`line-${index}`}>
                    <Line
                      points={[line.start.x, line.start.y, line.end.x, line.end.y]}
                      stroke="#ff00ff"
                      strokeWidth={2 / scale}
                    />
                    <Text
                      x={(line.start.x + line.end.x) / 2 + 5 / scale}
                      y={(line.start.y + line.end.y) / 2}
                      text={`${formatLength(Math.sqrt(Math.pow(line.end.x - line.start.x, 2) + Math.pow(line.end.y - line.start.y, 2)) * pixelsPerFoot, unit)}`}
                      fontSize={12 / scale}
                      fill="#ff00ff"
                      fontStyle="bold"
                      shadowColor="black"
                      shadowBlur={1}
                      shadowOffsetX={1 / scale}
                      shadowOffsetY={1 / scale}
                    />
                  </React.Fragment>
                ))}
              </Layer>
            )}
            
            {/* Custom Shape (Draw Area Tool) */}
            {drawAreaActive && customShapes && customShapes.length > 0 && (
              <Layer>
                {customShapes.map((shape, shapeIndex) => (
                  <React.Fragment key={`shape-${shapeIndex}`}>
                    <Line
                      points={shape.vertices.flatMap(v => [v.x, v.y])}
                      closed={shape.closed}
                      fill={shape.closed ? 'rgba(0, 255, 0, 0.3)' : 'transparent'}
                      stroke="#00ff00"
                      strokeWidth={2 / scale}
                    />
                    {shape.closed && shape.vertices.map((vertex, vertexIndex) => (
                      <Circle
                        key={`shape-${shapeIndex}-vertex-${vertexIndex}`}
                        x={vertex.x}
                        y={vertex.y}
                        radius={5 / scale}
                        fill="#00ff00"
                        stroke="#000000"
                        strokeWidth={1 / scale}
                        draggable
                        onDragStart={() => handleCustomVertexDragStart(shapeIndex, vertexIndex)}
                        onDragMove={handleCustomVertexDrag}
                        onDragEnd={handleCustomVertexDragEnd}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </Layer>
            )}
            
            {/* Custom Shape (Draw Area Tool) Preview */}
            {drawAreaActive && currentCustomShape && currentMousePos && (
              <Layer>
                <Line
                  points={currentCustomShape.vertices.flatMap(v => [v.x, v.y]).concat(currentCustomShape.vertices.length > 0 ? [currentMousePos.x, currentMousePos.y] : [])}
                  closed={false}
                  stroke="#00ff00"
                  strokeWidth={2 / scale}
                  dash={[6 / scale, 3 / scale]}
                />
                {currentCustomShape.vertices.map((vertex, index) => (
                  <Circle
                    key={`current-shape-vertex-${index}`}
                    x={vertex.x}
                    y={vertex.y}
                    radius={5 / scale}
                    fill={index === 0 ? '#00aaff' : '#00ff00'} // Highlight first vertex to indicate closing point
                    stroke="#000000"
                    strokeWidth={1 / scale}
                  />
                ))}
              </Layer>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;
