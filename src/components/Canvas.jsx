import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
// Snapping functionality removed - no longer needed
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
  onCustomShapeUpdate
}, ref) => {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1); // Track scale imperatively to avoid React reconciliation
  const [imageObj, setImageObj] = useState(null);
  const [draggingVertex, setDraggingVertex] = useState(null);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [roomStart, setRoomStart] = useState(null);
  const [draggingCustomVertex, setDraggingCustomVertex] = useState(null);
  const [currentMousePos, setCurrentMousePos] = useState(null);
  // Wall lines and intersection points removed - snapping disabled
  const isZoomingRef = useRef(false);
  const zoomTimeoutRef = useRef(null);

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
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setImageObj(img);
      // Delay fitToWindow to ensure image is loaded
      setTimeout(() => {
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
        }
      }, 100);
    };
    img.src = image;
  }, [image]);

  // Wall line detection removed - snapping functionality disabled

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
  const handleRoomDragStart = (e) => {
    if (!roomOverlay || lineToolActive || drawAreaActive) return;
    
    // Only start dragging if clicking on the rectangle itself, not the corners
    if (e.target.getClassName() === 'Rect') {
      setDraggingRoom(true);
      const canvasPos = getCanvasCoordinates(e.target.getStage());
      if (canvasPos) {
        setRoomStart(canvasPos);
      }
      e.cancelBubble = true;
    }
  };

  const handleRoomDrag = (e) => {
    if (!draggingRoom || !roomStart) return;
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (!canvasPos) return;
    
    const deltaX = canvasPos.x - roomStart.x;
    const deltaY = canvasPos.y - roomStart.y;
    
    const newOverlay = {
      x1: roomOverlay.x1 + deltaX,
      y1: roomOverlay.y1 + deltaY,
      x2: roomOverlay.x2 + deltaX,
      y2: roomOverlay.y2 + deltaY
    };
    
    onRoomOverlayUpdate(newOverlay);
    setRoomStart(canvasPos);
  };

  const handleRoomDragEnd = () => {
    setDraggingRoom(false);
    setRoomStart(null);
  };

  // Handle room corner dragging (no snapping)
  const handleRoomCornerDrag = (corner, e) => {
    if (!roomOverlay || lineToolActive || drawAreaActive) return;
    const canvasPos = getCanvasCoordinates(e.target.getStage());
    if (!canvasPos) return;
    
    const newOverlay = { ...roomOverlay };
    
    // Update overlay with raw positions (no snapping)
    if (corner === 'tl') {
      newOverlay.x1 = canvasPos.x;
      newOverlay.y1 = canvasPos.y;
    } else if (corner === 'tr') {
      newOverlay.x2 = canvasPos.x;
      newOverlay.y1 = canvasPos.y;
    } else if (corner === 'bl') {
      newOverlay.x1 = canvasPos.x;
      newOverlay.y2 = canvasPos.y;
    } else if (corner === 'br') {
      newOverlay.x2 = canvasPos.x;
      newOverlay.y2 = canvasPos.y;
    }
    
    onRoomOverlayUpdate(newOverlay);
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
    
    // Use raw position (no snapping)
    const newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = canvasPos;
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
    
    // Don't add vertex if clicking on an existing element
    const targetType = e.target.getType();
    if (targetType !== 'Stage' && targetType !== 'Image' && targetType !== 'Line') return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const clickPoint = getCanvasCoordinates(stage);
    if (!clickPoint) return;
    
    // Use raw click point (no snapping)
    const finalPoint = clickPoint;
    
    // Find the closest edge to insert the new vertex
    const vertices = perimeterOverlay.vertices;
    let closestEdgeIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      
      // Calculate distance from point to line segment
      const distance = pointToLineDistance(finalPoint, v1, v2);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestEdgeIndex = i;
      }
    }
    
    // Insert the new vertex after the closest edge start
    const newVertices = [...vertices];
    newVertices.splice(closestEdgeIndex + 1, 0, finalPoint);
    
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

  // Handle stage click for manual entry mode, line tool, or draw area tool
  const handleStageClick = (e) => {
    // Manual entry mode takes priority
    if (manualEntryMode && onCanvasClick) {
      const stage = e.target.getStage();
      if (!stage) return;
      
      const clickPoint = getCanvasCoordinates(stage);
      if (!clickPoint) return;
      
      onCanvasClick(clickPoint);
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
  };
  
  // Handle right click for line tool or draw area tool
  const handleStageContextMenu = (e) => {
    // Don't prevent default if clicking on a vertex (handled by vertex context menu)
    const targetType = e.target.getType();
    if (targetType === 'Circle') {
      return; // Let the vertex handle its own context menu
    }
    
    e.evt.preventDefault();
    
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
  
  // Handle mouse move for line tool or draw area tool preview
  const handleStageMouseMove = (e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const mousePoint = getCanvasCoordinates(stage);
    if (!mousePoint) return;
    
    setCurrentMousePos(mousePoint);
    
    // Line tool
    if (lineToolActive && measurementLine && measurementLine.start && onMeasurementLineUpdate) {
      onMeasurementLineUpdate({
        start: measurementLine.start,
        end: mousePoint
      });
    }
  };

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
    <div ref={containerRef} className="absolute inset-0 bg-white">
      {!image && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-xl text-slate-600 font-medium">Paste or Load a Sketch Image to Get Started</p>
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
          draggable={!draggingRoom && draggingVertex === null && draggingCustomVertex === null && !isZoomingRef.current && !manualEntryMode && !lineToolActive && !drawAreaActive}
          onClick={(manualEntryMode || lineToolActive || drawAreaActive) ? handleStageClick : undefined}
          onTap={(manualEntryMode || lineToolActive || drawAreaActive) ? handleStageClick : undefined}
          onContextMenu={handleStageContextMenu}
          onMouseMove={(lineToolActive || drawAreaActive) ? handleStageMouseMove : undefined}
          onDblClick={handleStageDoubleClick}
          onDblTap={handleStageDoubleClick}
        >
          <Layer>
            {/* Main Image */}
            <KonvaImage
              image={imageObj}
              x={0}
              y={0}
            />
            
            {/* Room Overlay */}
            {roomOverlay && (
              <>
                <Rect
                  x={Math.min(roomOverlay.x1, roomOverlay.x2)}
                  y={Math.min(roomOverlay.y1, roomOverlay.y2)}
                  width={Math.abs(roomOverlay.x2 - roomOverlay.x1)}
                  height={Math.abs(roomOverlay.y2 - roomOverlay.y1)}
                  stroke="#00ff00"
                  strokeWidth={2 / scale}
                  fill="rgba(0, 255, 0, 0.1)"
                  draggable
                  onDragStart={handleRoomDragStart}
                  onDragMove={handleRoomDrag}
                  onDragEnd={handleRoomDragEnd}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'move';
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'default';
                  }}
                />
                
                {/* Room Corner Handles */}
                {[
                  { x: roomOverlay.x1, y: roomOverlay.y1, corner: 'tl' },
                  { x: roomOverlay.x2, y: roomOverlay.y1, corner: 'tr' },
                  { x: roomOverlay.x1, y: roomOverlay.y2, corner: 'bl' },
                  { x: roomOverlay.x2, y: roomOverlay.y2, corner: 'br' }
                ].map((handle, i) => (
                  <Circle
                    key={i}
                    x={handle.x}
                    y={handle.y}
                    radius={6 / scale}
                    fill="#00ff00"
                    stroke="#fff"
                    strokeWidth={2 / scale}
                    draggable={!lineToolActive && !drawAreaActive}
                    onDragMove={(e) => handleRoomCornerDrag(handle.corner, e)}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = (!lineToolActive && !drawAreaActive) ? 'move' : 'default';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = 'default';
                    }}
                  />
                ))}
              </>
            )}
            
            {/* Perimeter Overlay */}
            {perimeterOverlay && perimeterOverlay.vertices && (
              <>
                <Line
                  points={perimeterOverlay.vertices.flatMap(v => [v.x, v.y])}
                  stroke="#ff00ff"
                  strokeWidth={2 / scale}
                  closed={true}
                  fill="rgba(255, 0, 255, 0.1)"
                  onDblClick={handleStageDoubleClick}
                  onDblTap={handleStageDoubleClick}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'crosshair';
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage().container();
                    container.style.cursor = 'default';
                  }}
                />
                
                {/* Perimeter Vertices */}
                {perimeterOverlay.vertices.map((vertex, i) => (
                  <Circle
                    key={i}
                    x={vertex.x}
                    y={vertex.y}
                    radius={6 / scale}
                    fill="#ff00ff"
                    stroke="#fff"
                    strokeWidth={2 / scale}
                    draggable={!lineToolActive && !drawAreaActive}
                    onDragStart={() => handleVertexDragStart(i)}
                    onDragMove={(e) => handleVertexDrag(i, e)}
                    onDragEnd={() => handleVertexDragEnd(i)}
                    onContextMenu={(e) => handleVertexContextMenu(i, e)}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = (!lineToolActive && !drawAreaActive) ? 'move' : 'default';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = 'default';
                    }}
                  />
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
                      stroke="#ff9800"
                      strokeWidth={2 / scale}
                      fill="rgba(255, 152, 0, 0.2)"
                      onClick={() => onDimensionSelect && onDimensionSelect(dim)}
                      onTap={() => onDimensionSelect && onDimensionSelect(dim)}
                      onMouseEnter={(e) => {
                        const container = e.target.getStage().container();
                        container.style.cursor = 'pointer';
                      }}
                      onMouseLeave={(e) => {
                        const container = e.target.getStage().container();
                        container.style.cursor = 'default';
                      }}
                    />
                    {/* Label with dimension text */}
                    <Text
                      x={dim.bbox.x}
                      y={dim.bbox.y - 20 / scale}
                      text={dim.text}
                      fontSize={14 / scale}
                      fill="#ff9800"
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
                  fill="#ff9800"
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
            
            {/* Manual Mode Active but no dimensions detected */}
            {mode === 'manual' && (!detectedDimensions || detectedDimensions.length === 0) && !manualEntryMode && (
              <Text
                x={10}
                y={10}
                text="Enter dimensions in sidebar and click on canvas"
                fontSize={16 / scale}
                fill="orange"
                fontStyle="bold"
              />
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
                  stroke="#3b82f6"
                  strokeWidth={3 / scale}
                  lineCap="round"
                  lineJoin="round"
                />
                
                {/* Start point circle */}
                <Circle
                  x={measurementLine.start.x}
                  y={measurementLine.start.y}
                  radius={6 / scale}
                  fill="#3b82f6"
                  stroke="#fff"
                  strokeWidth={2 / scale}
                />
                
                {/* End point circle */}
                <Circle
                  x={measurementLine.end.x}
                  y={measurementLine.end.y}
                  radius={6 / scale}
                  fill="#3b82f6"
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
                    stroke="#f59e0b"
                    strokeWidth={2 / scale}
                    dash={[10 / scale, 5 / scale]}
                    lineCap="round"
                  />
                )}
                
                {/* The custom shape */}
                <Line
                  points={customShape.vertices.flatMap(v => [v.x, v.y])}
                  stroke="#f59e0b"
                  strokeWidth={3 / scale}
                  closed={customShape.closed}
                  fill={customShape.closed ? "rgba(245, 158, 11, 0.2)" : undefined}
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
                    fill="#f59e0b"
                    stroke="#fff"
                    strokeWidth={2 / scale}
                    draggable={customShape.closed}
                    onDragStart={() => handleCustomVertexDragStart(i)}
                    onDragMove={(e) => handleCustomVertexDrag(i, e)}
                    onDragEnd={() => handleCustomVertexDragEnd(i)}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = customShape.closed ? 'move' : 'pointer';
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = 'default';
                    }}
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
