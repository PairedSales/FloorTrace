import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Text } from 'react-konva';
import { 
  findAllIntersectionPoints, 
  findNearestIntersection, 
  applySecondaryAlignment,
  snapEdgeToLines,
  SNAP_TO_LINE_DISTANCE,
  SNAP_TO_INTERSECTION_DISTANCE,
  SECONDARY_ALIGNMENT_DISTANCE
} from '../utils/snappingHelper';

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
  pixelsPerFoot
}, ref) => {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [imageObj, setImageObj] = useState(null);
  const [draggingVertex, setDraggingVertex] = useState(null);
  const [draggingRoom, setDraggingRoom] = useState(false);
  const [roomStart, setRoomStart] = useState(null);
  const [wallLines, setWallLines] = useState({ horizontal: [], vertical: [] });
  const [intersectionPoints, setIntersectionPoints] = useState([]);

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

    setScale(newScale);
    
    // Center the stage
    if (stageRef.current) {
      const stage = stageRef.current;
      stage.position({
        x: (containerWidth - imgWidth * newScale) / 2,
        y: (containerHeight - imgHeight * newScale) / 2
      });
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

          setScale(newScale);
          
          if (stageRef.current) {
            const stage = stageRef.current;
            stage.position({
              x: (containerWidth - imgWidth * newScale) / 2,
              y: (containerHeight - imgHeight * newScale) / 2
            });
          }
        }
      }, 100);
    };
    img.src = image;
  }, [image]);

  // Detect wall lines when image changes
  useEffect(() => {
    if (!imageObj) {
      setWallLines({ horizontal: [], vertical: [] });
      setIntersectionPoints([]);
      return;
    }

    // Simplified wall line detection - detect major edges
    const detectWallLines = () => {
      const canvas = document.createElement('canvas');
      canvas.width = imageObj.width;
      canvas.height = imageObj.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageObj, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Simple edge detection by looking for dark pixels
      const horizontalLines = new Set();
      const verticalLines = new Set();
      const threshold = 128;
      
      // Scan for horizontal lines
      for (let y = 0; y < canvas.height; y += 5) {
        let darkPixels = 0;
        for (let x = 0; x < canvas.width; x += 5) {
          const idx = (y * canvas.width + x) * 4;
          const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (brightness < threshold) darkPixels++;
        }
        if (darkPixels > canvas.width / 50) {
          horizontalLines.add(y);
        }
      }
      
      // Scan for vertical lines
      for (let x = 0; x < canvas.width; x += 5) {
        let darkPixels = 0;
        for (let y = 0; y < canvas.height; y += 5) {
          const idx = (y * canvas.width + x) * 4;
          const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (brightness < threshold) darkPixels++;
        }
        if (darkPixels > canvas.height / 50) {
          verticalLines.add(x);
        }
      }
      
      const hLines = Array.from(horizontalLines);
      const vLines = Array.from(verticalLines);
      
      setWallLines({ horizontal: hLines, vertical: vLines });
      
      // Calculate intersection points
      const intersections = findAllIntersectionPoints(hLines, vLines);
      setIntersectionPoints(intersections);
    };

    detectWallLines();
  }, [imageObj]);

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

  // Handle room overlay dragging (move entire overlay)
  const handleRoomDragStart = (e) => {
    if (mode === 'manual' || !roomOverlay) return;
    
    // Only start dragging if clicking on the rectangle itself, not the corners
    if (e.target.getClassName() === 'Rect') {
      setDraggingRoom(true);
      const pos = e.target.getStage().getPointerPosition();
      setRoomStart({ x: pos.x / scale, y: pos.y / scale });
      e.cancelBubble = true;
    }
  };

  const handleRoomDrag = (e) => {
    if (!draggingRoom || !roomStart) return;
    const pos = e.target.getStage().getPointerPosition();
    const newX = pos.x / scale;
    const newY = pos.y / scale;
    
    const deltaX = newX - roomStart.x;
    const deltaY = newY - roomStart.y;
    
    const newOverlay = {
      x1: roomOverlay.x1 + deltaX,
      y1: roomOverlay.y1 + deltaY,
      x2: roomOverlay.x2 + deltaX,
      y2: roomOverlay.y2 + deltaY
    };
    
    onRoomOverlayUpdate(newOverlay);
    setRoomStart({ x: newX, y: newY });
  };

  const handleRoomDragEnd = () => {
    setDraggingRoom(false);
    setRoomStart(null);
  };

  // Handle room corner dragging with snapping
  const handleRoomCornerDrag = (corner, e) => {
    if (!roomOverlay) return;
    const pos = e.target.getStage().getPointerPosition();
    let newX = pos.x / scale;
    let newY = pos.y / scale;
    
    const newOverlay = { ...roomOverlay };
    
    // Determine which edges are being moved
    const movingLeft = corner === 'tl' || corner === 'bl';
    const movingTop = corner === 'tl' || corner === 'tr';
    const movingRight = corner === 'tr' || corner === 'br';
    const movingBottom = corner === 'bl' || corner === 'br';
    
    // Apply snapping to edges
    if (movingLeft || movingRight) {
      const xSign = movingLeft ? -1 : 1;
      
      const snapped = snapEdgeToLines(
        movingLeft ? newX : newOverlay.x1,
        movingLeft ? (newOverlay.x2 - newX) : (newX - newOverlay.x1),
        wallLines.vertical,
        SNAP_TO_LINE_DISTANCE,
        xSign
      );
      
      if (movingLeft) {
        newX = snapped.position;
      } else {
        newX = snapped.position + snapped.size;
      }
    }
    
    if (movingTop || movingBottom) {
      const ySign = movingTop ? -1 : 1;
      
      const snapped = snapEdgeToLines(
        movingTop ? newY : newOverlay.y1,
        movingTop ? (newOverlay.y2 - newY) : (newY - newOverlay.y1),
        wallLines.horizontal,
        SNAP_TO_LINE_DISTANCE,
        ySign
      );
      
      if (movingTop) {
        newY = snapped.position;
      } else {
        newY = snapped.position + snapped.size;
      }
    }
    
    // Update overlay with snapped positions
    if (corner === 'tl') {
      newOverlay.x1 = newX;
      newOverlay.y1 = newY;
    } else if (corner === 'tr') {
      newOverlay.x2 = newX;
      newOverlay.y1 = newY;
    } else if (corner === 'bl') {
      newOverlay.x1 = newX;
      newOverlay.y2 = newY;
    } else if (corner === 'br') {
      newOverlay.x2 = newX;
      newOverlay.y2 = newY;
    }
    
    onRoomOverlayUpdate(newOverlay);
  };

  // Handle perimeter vertex dragging with snapping
  const handleVertexDragStart = (index) => {
    if (!perimeterOverlay) return;
    setDraggingVertex(index);
  };

  const handleVertexDrag = (index, e) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    const pos = e.target.getStage().getPointerPosition();
    const currentPoint = { x: pos.x / scale, y: pos.y / scale };
    
    // Apply snapping to intersection points for visual feedback
    const snappedPoint = findNearestIntersection(
      currentPoint,
      intersectionPoints,
      SNAP_TO_INTERSECTION_DISTANCE
    );
    
    // Use snapped position if available, otherwise use raw position
    const finalPoint = snappedPoint || currentPoint;
    
    const newVertices = [...perimeterOverlay.vertices];
    newVertices[index] = finalPoint;
    onPerimeterUpdate(newVertices);
  };

  const handleVertexDragEnd = (index) => {
    if (!perimeterOverlay || draggingVertex !== index) return;
    
    // Apply secondary alignment to nearby vertices
    const vertices = [...perimeterOverlay.vertices];
    const snappedPoint = vertices[index];
    
    // Check if this point was snapped to an intersection
    const wasSnapped = intersectionPoints.some(
      intersection => 
        Math.abs(intersection.x - snappedPoint.x) < 1 &&
        Math.abs(intersection.y - snappedPoint.y) < 1
    );
    
    if (wasSnapped) {
      applySecondaryAlignment(
        vertices,
        index,
        snappedPoint,
        SECONDARY_ALIGNMENT_DISTANCE
      );
      onPerimeterUpdate(vertices);
    }
    
    setDraggingVertex(null);
  };

  // Handle double-click on perimeter line or stage to add vertex
  const handlePerimeterDoubleClick = (e) => {
    if (!perimeterOverlay) return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (!pos) return;
    
    const clickPoint = { x: pos.x / scale, y: pos.y / scale };
    
    // Apply snapping to intersection points
    const snappedPoint = findNearestIntersection(
      clickPoint,
      intersectionPoints,
      SNAP_TO_INTERSECTION_DISTANCE
    );
    
    const finalPoint = snappedPoint || clickPoint;
    
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
    
    // Apply secondary alignment if snapped
    if (snappedPoint) {
      applySecondaryAlignment(
        newVertices,
        closestEdgeIndex + 1,
        finalPoint,
        SECONDARY_ALIGNMENT_DISTANCE
      );
    }
    
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

  // Handle zoom
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    setScale(newScale);
    
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale
    };
    
    stage.position(newPos);
  };

  return (
    <div ref={containerRef} className="absolute inset-0 bg-white">
      {!image && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-2">No image loaded</p>
            <p className="text-sm text-gray-400">Load an image or paste from clipboard to begin</p>
          </div>
        </div>
      )}
      
      {isProcessing && (
        <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="text-gray-700">Processing...</span>
            </div>
          </div>
        </div>
      )}
      
      {imageObj && (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          scaleX={scale}
          scaleY={scale}
          onWheel={handleWheel}
          draggable={!draggingRoom && draggingVertex === null}
          onDblClick={perimeterOverlay ? handlePerimeterDoubleClick : undefined}
          onDblTap={perimeterOverlay ? handlePerimeterDoubleClick : undefined}
        >
          <Layer
            onDblClick={perimeterOverlay ? handlePerimeterDoubleClick : undefined}
            onDblTap={perimeterOverlay ? handlePerimeterDoubleClick : undefined}
          >
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
                    draggable
                    onDragMove={(e) => handleRoomCornerDrag(handle.corner, e)}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = 'move';
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
                  onDblClick={handlePerimeterDoubleClick}
                  onDblTap={handlePerimeterDoubleClick}
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
                    draggable
                    onDragStart={() => handleVertexDragStart(i)}
                    onDragMove={(e) => handleVertexDrag(i, e)}
                    onDragEnd={() => handleVertexDragEnd(i)}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage().container();
                      container.style.cursor = 'move';
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
                  
                  // Calculate midpoint for label placement
                  const midX = (vertex.x + nextVertex.x) / 2;
                  const midY = (vertex.y + nextVertex.y) / 2;
                  
                  // Calculate offset perpendicular to the line (for label positioning)
                  const angle = Math.atan2(dy, dx);
                  const offsetDistance = 15 / scale; // Offset from the line
                  const offsetX = Math.sin(angle) * offsetDistance;
                  const offsetY = -Math.cos(angle) * offsetDistance;
                  
                  return (
                    <React.Fragment key={`label-${i}`}>
                      {/* Modern minimalist background */}
                      <Rect
                        x={midX + offsetX - 28 / scale}
                        y={midY + offsetY - 11 / scale}
                        width={56 / scale}
                        height={22 / scale}
                        fill="rgba(17, 24, 39, 0.95)"
                        strokeWidth={0}
                        cornerRadius={6 / scale}
                      />
                      {/* Clean label text */}
                      <Text
                        x={midX + offsetX}
                        y={midY + offsetY}
                        text={`${lengthInFeet.toFixed(1)} ft`}
                        fontSize={11 / scale}
                        fill="#ffffff"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontStyle="500"
                        align="center"
                        verticalAlign="middle"
                        offsetX={28 / scale}
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
            
            {/* Manual Mode Active but no dimensions detected */}
            {mode === 'manual' && (!detectedDimensions || detectedDimensions.length === 0) && (
              <Text
                x={10}
                y={10}
                text="Manual Mode: No dimensions detected"
                fontSize={16 / scale}
                fill="orange"
              />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;
