import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
import { formatLength } from '../utils/unitConverter';

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
  measurementLine,
  onMeasurementLineUpdate,
  drawAreaActive,
  customShape,
  onCustomShapeUpdate,
  isMobile,
  perimeterVertices,
  onAddPerimeterVertex,
  onRemovePerimeterVertex
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
  const [draggingCustomVertex, setDraggingCustomVertex] = useState(null);
  const [currentMousePos, setCurrentMousePos] = useState(null);
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);
  
  // Mobile touch gesture state
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [touchStartPos, setTouchStartPos] = useState(null);
  const [showDeleteOption, setShowDeleteOption] = useState(null); // vertex index to show delete option
  const touchMoveThreshold = 10; // pixels to distinguish tap from drag
  const longPressDelay = 500; // milliseconds for long press

  // Fit to window function
  const fitToWindow = () => {
    if (!imageObj || !containerRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    const containerHeight = containerRef.current.offsetHeight;
    const imgWidth = imageObj.width;
    const imgHeight = imageObj.height;

    const scaleX = containerWidth / imgWidth;
    const scaleY = containerHeight / imgHeight;
    const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

    scaleRef.current = newScale;
    setScale(newScale);
    
    // Center the stage
    if (stageRef.current) {
      const stage = stageRef.current;
      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: (containerWidth - imgWidth * newScale) / 2,
        y: (containerHeight - imgHeight * newScale) / 2
      });
      stage.batchDraw();
    }
  };

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
      // Fit to window before displaying
      requestAnimationFrame(() => {
        if (containerRef.current && img) {
          const containerWidth = containerRef.current.offsetWidth;
          const containerHeight = containerRef.current.offsetHeight;
          const imgWidth = img.width;
          const imgHeight = img.height;

          const scaleX = containerWidth / imgWidth;
          const scaleY = containerHeight / imgHeight;
          const newScale = Math.min(scaleX, scaleY) * 0.9;

          scaleRef.current = newScale;
          setScale(newScale);
          
          if (stageRef.current) {
            const stage = stageRef.current;
            stage.scale({ x: newScale, y: newScale });
            stage.position({
              x: (containerWidth - imgWidth * newScale) / 2,
              y: (containerHeight - imgHeight * newScale) / 2
            });
            stage.batchDraw();
          }
          
          // Now show the image after it's fitted
          setIsImageReady(true);
        }
      });
    };
    img.src = image;
  }, [image]);


  // Update container dimensions (robust for absolute/flex layouts)
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
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    setDraggingRoom(true);
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (canvasPos) {
      setRoomStart(canvasPos);
    }
  };

  // Handle room corner dragging (no snapping)
  const handleRoomCornerMouseDown = (corner, e) => {
    if (!roomOverlay || lineToolActive || drawAreaActive) return;
    
    e.cancelBubble = true;
    e.evt.preventDefault();
    
    setDraggingRoomCorner(corner);
  };

  // Handle perimeter vertex dragging (no snapping)
  const handleVertexDragStart = (index) => {
    if (!perimeterOverlay || lineToolActive || drawAreaActive) return;
    setDraggingVertex(index);
  };

  const handleVertexDrag = (index, e) => {
    if (!perimeterOverlay || draggingVertex !== index || lineToolActive || drawAreaActive) return;
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (!canvasPos) return;
    
    let newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = { x: canvasPos.x, y: canvasPos.y };
    
    onPerimeterUpdate(newVertices);
  };

  const handleVertexDragEnd = (index) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    setDraggingVertex(null);
  };

  // Handle perimeter vertex right-click to delete
  const handleVertexContextMenu = (index, e) => {
    e.evt.preventDefault();
    if (!perimeterOverlay || lineToolActive || drawAreaActive) return;
    
    // Don't allow deleting if we only have 3 vertices (minimum for a polygon)
    if (perimeterOverlay.vertices.length <= 3) {
      return;
    }
    
    const newVertices = perimeterOverlay.vertices.filter((_, i) => i !== index);
    onPerimeterUpdate(newVertices);
  };
  
  // Delete perimeter vertex (for mobile)
  const deletePerimeterVertex = (index) => {
    if (!perimeterOverlay || perimeterOverlay.vertices.length <= 3) return;
    const newVertices = perimeterOverlay.vertices.filter((_, i) => i !== index);
    onPerimeterUpdate(newVertices);
    setShowDeleteOption(null);
  };

  // Handle custom shape vertex dragging
  const handleCustomVertexDragStart = (index) => {
    if (!customShape || !customShape.closed) return;
    setDraggingCustomVertex(index);
  };

  const handleCustomVertexDrag = (index, e) => {
    if (!customShape || draggingCustomVertex !== index) return;
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (!canvasPos) return;
    
    const newVertices = [...customShape.vertices];
    newVertices[index] = canvasPos;
    onCustomShapeUpdate({ vertices: newVertices, closed: true });
  };

  const handleCustomVertexDragEnd = (index) => {
    if (!customShape || draggingCustomVertex !== index) return;
    setDraggingCustomVertex(null);
  };

  // Handle double-click to close custom shape or add perimeter vertex
  const handleStageDoubleClick = (e) => {
    // Draw area tool - close the shape
    if (drawAreaActive && customShape && !customShape.closed && customShape.vertices.length >= 3) {
      onCustomShapeUpdate({
        vertices: customShape.vertices,
        closed: true
      });
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
    newVertices.splice(closestEdgeIndex + 1, 0, clickPoint);
    
    onPerimeterUpdate(newVertices);
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
      
      onRoomOverlayUpdate(newOverlay);
      setRoomStart(mousePoint);
      return;
    }
    
    // Handle room corner dragging
    if (draggingRoomCorner && roomOverlay) {
      const newOverlay = { ...roomOverlay };
      
      if (draggingRoomCorner === 'tl') {
        newOverlay.x1 = mousePoint.x;
        newOverlay.y1 = mousePoint.y;
      } else if (draggingRoomCorner === 'tr') {
        newOverlay.x2 = mousePoint.x;
        newOverlay.y1 = mousePoint.y;
      } else if (draggingRoomCorner === 'bl') {
        newOverlay.x1 = mousePoint.x;
        newOverlay.y2 = mousePoint.y;
      } else if (draggingRoomCorner === 'br') {
        newOverlay.x2 = mousePoint.x;
        newOverlay.y2 = mousePoint.y;
      }
      
      onRoomOverlayUpdate(newOverlay);
      return;
    }
    
    // Line tool preview
    if (lineToolActive && measurementLine && measurementLine.start && onMeasurementLineUpdate) {
      onMeasurementLineUpdate({
        start: measurementLine.start,
        end: mousePoint
      });
    }
  };
  
  // Handle global mouse up
  const handleStageMouseUp = () => {
    if (draggingRoom) {
      setDraggingRoom(false);
      setRoomStart(null);
    }
    if (draggingRoomCorner) {
      setDraggingRoomCorner(null);
    }
  };

  // Handle stage click for manual entry mode, line tool, draw area tool, or perimeter vertex placement
  const handleStageClick = (e) => {
    // Check if we're in a mode that needs single-click handling
    const needsSingleClickHandling = 
      (manualEntryMode && onCanvasClick) ||
      (roomOverlay && !perimeterOverlay && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== undefined) ||
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
    if (clickCountRef.current === 2) {
      clickCountRef.current = 0;
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
      
      // Perimeter vertex placement mode (room overlay exists, no perimeter overlay, no tools active)
      if (roomOverlay && !perimeterOverlay && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== undefined) {
        // Don't place vertex if clicking on room overlay (allow dragging though)
        const targetType = e.target.getType();
        if (targetType === 'Rect' || targetType === 'Circle') {
          return; // Clicked on room overlay or its handles
        }
        
        const stage = e.target.getStage();
        if (!stage) return;
        
        const clickPoint = getCanvasCoordinates(stage);
        if (!clickPoint) return;
        
        onAddPerimeterVertex(clickPoint);
        return;
      }
      
      // Line tool mode
      if (lineToolActive && onMeasurementLineUpdate) {
        const stage = e.target.getStage();
        if (!stage) return;
        
        const clickPoint = getCanvasCoordinates(stage);
        if (!clickPoint) return;
        
        // If no start point, set it
        if (!measurementLine || !measurementLine.start) {
          onMeasurementLineUpdate({ start: clickPoint, end: clickPoint });
        }
        // If we already have a start point, this is just updating the end point
        // (the end point is continuously updated by mouse move)
        return;
      }
      
      // Draw area tool mode
      if (drawAreaActive && onCustomShapeUpdate) {
        const stage = e.target.getStage();
        if (!stage) return;
        
        const clickPoint = getCanvasCoordinates(stage);
        if (!clickPoint) return;
        
        // Add vertex to the shape
        if (!customShape || !customShape.vertices) {
          // Start new shape
          onCustomShapeUpdate({ vertices: [clickPoint], closed: false });
        } else if (!customShape.closed) {
          // Add vertex to existing shape
          onCustomShapeUpdate({
            vertices: [...customShape.vertices, clickPoint],
            closed: false
          });
        }
      }
    }, 50); // Wait 50ms to distinguish single from double-click (faster response)
  };
  
  // Handle right click for line tool, draw area tool, or perimeter vertex placement
  const handleStageContextMenu = (e) => {
    // Don't prevent default if clicking on a vertex (handled by vertex context menu)
    const targetType = e.target.getType();
    if (targetType === 'Circle') {
      return; // Let the vertex handle its own context menu
    }
    
    e.evt.preventDefault();
    
    // Perimeter vertex placement mode - remove last vertex
    if (roomOverlay && !perimeterOverlay && !lineToolActive && !drawAreaActive && onRemovePerimeterVertex && perimeterVertices && perimeterVertices.length > 0) {
      onRemovePerimeterVertex();
      return;
    }
    
    if (lineToolActive && onMeasurementLineUpdate) {
      onMeasurementLineUpdate(null);
      return;
    }
    
    if (drawAreaActive && onCustomShapeUpdate && customShape && !customShape.closed) {
      // Remove last vertex
      if (customShape.vertices.length > 1) {
        onCustomShapeUpdate({
          vertices: customShape.vertices.slice(0, -1),
          closed: false
        });
      } else {
        // Clear shape if only one vertex
        onCustomShapeUpdate(null);
      }
    }
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
        
        const newVertices = [...vertices];
        newVertices.splice(closestEdgeIndex + 1, 0, canvasPos);
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
                      radius={isMobile ? 12 / scale : 6 / scale}
                      fill="#10b981"
                      stroke="#fff"
                      strokeWidth={2 / scale}
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
                      radius={isMobile ? 12 / scale : 6 / scale}
                      fill="#6366f1"
                      stroke="#fff"
                      strokeWidth={2 / scale}
                      draggable={!lineToolActive && !drawAreaActive}
                      onDragStart={() => handleVertexDragStart(i)}
                      onDragMove={(e) => handleVertexDrag(i, e)}
                      onDragEnd={() => handleVertexDragEnd(i)}
                      onContextMenu={(e) => handleVertexContextMenu(i, e)}
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
                      text={`${formatLength(dim.width, unit)} x ${formatLength(dim.height, unit)}`}
                      fontSize={14 / scale}
                      fill="#8b5cf6"
                      fontStyle="bold"
                    />
                  </React.Fragment>
                ))}
                {/* Instructions */}
                <Text
                  x={10}
                  y={10}
                  text="Click on a room dimension to select it"
                  fontSize={16 / scale}
                  fill="#8b5cf6"
                  fontStyle="bold"
                />
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
                      radius={isMobile ? 12 / scale : 6 / scale}
                      fill="#f59e0b"
                      stroke="#fff"
                      strokeWidth={2 / scale}
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
            {lineToolActive && measurementLine && measurementLine.start && measurementLine.end && (
              <>
                {/* The measurement line */}
                <Line
                  points={[
                    measurementLine.start.x,
                    measurementLine.start.y,
                    measurementLine.end.x,
                    measurementLine.end.y
                  ]}
                  stroke="#0ea5e9"
                  strokeWidth={3 / scale}
                  lineCap="round"
                  lineJoin="round"
                />
                
                {/* Start point circle */}
                <Circle
                  x={measurementLine.start.x}
                  y={measurementLine.start.y}
                  radius={6 / scale}
                  fill="#0ea5e9"
                  stroke="#fff"
                  strokeWidth={2 / scale}
                />
                
                {/* End point circle */}
                <Circle
                  x={measurementLine.end.x}
                  y={measurementLine.end.y}
                  radius={6 / scale}
                  fill="#0ea5e9"
                  stroke="#fff"
                  strokeWidth={2 / scale}
                />
                
                {/* Length label */}
                {(() => {
                  // Calculate line length in pixels
                  const dx = measurementLine.end.x - measurementLine.start.x;
                  const dy = measurementLine.end.y - measurementLine.start.y;
                  const lengthInPixels = Math.sqrt(dx * dx + dy * dy);
                  
                  // Convert to feet using pixelsPerFoot scale
                  const lengthInFeet = lengthInPixels * pixelsPerFoot;
                  
                  // Format based on unit preference
                  const formattedLength = formatLength(lengthInFeet, unit);
                  
                  // Calculate midpoint for label placement
                  const midX = (measurementLine.start.x + measurementLine.end.x) / 2;
                  const midY = (measurementLine.start.y + measurementLine.end.y) / 2;
                  
                  // Calculate offset perpendicular to the line
                  const angle = Math.atan2(dy, dx);
                  const offsetDistance = 20 / scale;
                  const offsetX = Math.sin(angle) * offsetDistance;
                  const offsetY = -Math.cos(angle) * offsetDistance;
                  
                  // Dynamic width based on text length
                  const labelWidth = Math.max(60, formattedLength.length * 7) / scale;
                  
                  return (
                    <React.Fragment>
                      {/* Label background */}
                      <Rect
                        x={midX + offsetX - labelWidth / 2}
                        y={midY + offsetY - 13 / scale}
                        width={labelWidth}
                        height={26 / scale}
                        fill="rgba(59, 130, 246, 0.95)"
                        strokeWidth={0}
                        cornerRadius={6 / scale}
                      />
                      {/* Label text */}
                      <Text
                        x={midX + offsetX}
                        y={midY + offsetY}
                        text={formattedLength}
                        fontSize={12 / scale}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontStyle="600"
                        align="center"
                        verticalAlign="middle"
                        offsetX={labelWidth / 2}
                        offsetY={6.5 / scale}
                      />
                    </React.Fragment>
                  );
                })()}
              </>
            )}
            
            {/* Custom Shape (Draw Area Tool) */}
            {drawAreaActive && customShape && customShape.vertices && customShape.vertices.length > 0 && (
              <>
                {/* Preview line from last vertex to mouse (when not closed) */}
                {!customShape.closed && currentMousePos && customShape.vertices.length > 0 && (
                  <Line
                    points={[
                      customShape.vertices[customShape.vertices.length - 1].x,
                      customShape.vertices[customShape.vertices.length - 1].y,
                      currentMousePos.x,
                      currentMousePos.y
                    ]}
                    stroke="#ec4899"
                    strokeWidth={2 / scale}
                    dash={[10 / scale, 5 / scale]}
                    lineCap="round"
                  />
                )}
                
                {/* The custom shape */}
                <Line
                  points={customShape.vertices.flatMap(v => [v.x, v.y])}
                  stroke="#ec4899"
                  strokeWidth={3 / scale}
                  closed={customShape.closed}
                  fill={customShape.closed ? "rgba(236, 72, 153, 0.15)" : undefined}
                  lineCap="round"
                  lineJoin="round"
                />
                
                {/* Vertices */}
                {customShape.vertices.map((vertex, i) => (
                  <Circle
                    key={i}
                    x={vertex.x}
                    y={vertex.y}
                    radius={6 / scale}
                    fill="#ec4899"
                    stroke="#fff"
                    strokeWidth={2 / scale}
                    draggable={customShape.closed}
                    onDragStart={() => handleCustomVertexDragStart(i)}
                    onDragMove={(e) => handleCustomVertexDrag(i, e)}
                    onDragEnd={() => handleCustomVertexDragEnd(i)}
                  />
                ))}
                
                {/* Area label - only when shape is closed or has at least 3 vertices */}
                {customShape.vertices.length >= 3 && pixelsPerFoot && (() => {
                  // Calculate area using shoelace formula
                  let area = 0;
                  const vertices = customShape.vertices;
                  for (let i = 0; i < vertices.length; i++) {
                    const j = (i + 1) % vertices.length;
                    area += vertices[i].x * vertices[j].y;
                    area -= vertices[j].x * vertices[i].y;
                  }
                  area = Math.abs(area / 2);
                  
                  // Convert from pixels² to feet²
                  const areaInFeet = area * (pixelsPerFoot * pixelsPerFoot);
                  
                  // Calculate centroid for label placement
                  let centroidX = 0;
                  let centroidY = 0;
                  for (let i = 0; i < vertices.length; i++) {
                    centroidX += vertices[i].x;
                    centroidY += vertices[i].y;
                  }
                  centroidX /= vertices.length;
                  centroidY /= vertices.length;
                  
                  const areaText = `${Math.round(areaInFeet).toLocaleString()} ft²`;
                  const labelWidth = Math.max(80, areaText.length * 8) / scale;
                  
                  return (
                    <React.Fragment>
                      {/* Label background */}
                      <Rect
                        x={centroidX - labelWidth / 2}
                        y={centroidY - 16 / scale}
                        width={labelWidth}
                        height={32 / scale}
                        fill="rgba(245, 158, 11, 0.95)"
                        strokeWidth={0}
                        cornerRadius={8 / scale}
                      />
                      {/* Label text */}
                      <Text
                        x={centroidX}
                        y={centroidY}
                        text={areaText}
                        fontSize={14 / scale}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontStyle="700"
                        align="center"
                        verticalAlign="middle"
                        offsetX={labelWidth / 2}
                        offsetY={8 / scale}
                      />
                    </React.Fragment>
                  );
                })()}
              </>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;
