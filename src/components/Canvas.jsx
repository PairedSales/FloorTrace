import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Text, Rect } from 'react-konva';
import useAppStore from '../store/appStore';
import { createImageSnapAnalyzer } from '../utils/imageSnapper';
import { RoomOverlayLayer, PerimeterLayer, MeasurementLayer, ShapeLayer, DimensionOverlay, PerimeterPlacementLayer, DetectionDebugOverlay, AngleOverlay, getCanvasCoordinates, pointToLineDistance } from './canvas/index.js';
import { useCanvasZoom } from '../hooks/useCanvasZoom';
import { useCanvasPan } from '../hooks/useCanvasPan';
import { useEraserTool } from '../hooks/useEraserTool';
import { useCropTool } from '../hooks/useCropTool';
import { getUnitStyleFromDimensions } from '../utils/unitConverter';

const Canvas = React.memo(forwardRef(({
  image,
  roomOverlay,
  perimeterOverlay,
  perimeterTraces,
  activeTraceId,
  traceInteractionMode,
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
  cropToolActive,
  onCropToolToggle,
  onImageUpdate,
  angleToolActive,
  angleToolState,
  onAngleToolStateChange,
  onAngleToolToggle,
}, ref) => {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const renderCountRef = useRef(0);
  if (import.meta.env?.DEV) {
    renderCountRef.current += 1;
    console.log(`[Canvas] Render count: ${renderCountRef.current}`);
  }
  const backgroundImageLayerRef = useRef(null);
  const contentLayerRef = useRef(null);
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
  const [draggingAngle, setDraggingAngle] = useState(false);
  
  // Local drag state to bypass global Zustand store updates at 60fps
  const [localPerimeterVertices, setLocalPerimeterVertices] = useState(null);
  const [localRoomOverlay, setLocalRoomOverlay] = useState(null);
  const [localMeasurementLine, setLocalMeasurementLine] = useState(null);

  const clickTimeoutRef = useRef(null);
  const clickCountRef = useRef(0);

  // Zustand visual transform selectors
  const zoomScale = useAppStore((s) => s.zoomScale);
  const stageX = useAppStore((s) => s.stageX);
  const stageY = useAppStore((s) => s.stageY);
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  const viewportSyncToken = useAppStore((s) => s.viewportSyncToken);
  const setViewportTransform = useAppStore((s) => s.setViewportTransform);
  const setCanvasRotation = useAppStore((s) => s.setCanvasRotation);

  const lastDraggedVertexRef = useRef(null); // Track last dragged vertex index
  const lastDragStartPosRef = useRef(null); // Track starting position before drag
  const lastRoomDragStartRef = useRef(null); // Track room overlay before move/resize
  const isDraggingRef = useRef(false); // Track if any drag operation is in progress
  const dragStartPosRef = useRef(null); // Track initial mouse position to detect drag vs click
  const imageSnapAnalyzerRef = useRef(null);
  const imageSnapAnalyzerSourceRef = useRef(null);
  const imageSnapAnalyzerLoadingRef = useRef(null);

  // Track the previous imageObj dimensions so fitToWindow is only triggered
  // when the image actually changes size (not after same-size eraser/crop edits).
  const prevImageDimsRef = useRef(null);

  const unitStyle = useMemo(() => getUnitStyleFromDimensions(detectedDimensions, unit), [detectedDimensions, unit]);

  // ── Composable hooks ───────────────────────────────────────────────────────

  // Helper: convert screen coordinates to canvas coordinates (image-space)
  // Defined early so hooks that need it can reference it via closure.
  const getCanvasCoords = useCallback(
    (stage) => getCanvasCoordinates(stage, scaleRef, contentLayerRef),
    [] // refs are stable — no deps needed
  );

  const viewportSyncTokenRef = useRef(null);

  const { handleWheel, isZoomingRef } = useCanvasZoom(stageRef, scaleRef, setScale, viewportSyncTokenRef);

  const { canPanCanvas, handleStageDragStart, handleStageDragEnd } = useCanvasPan({
    stageRef,
    scaleRef,
    isDraggingRef,
    dragStartPosRef,
    isZoomingRef,
    draggingRoom,
    draggingRoomCorner,
    draggingVertex,
    draggingAngle,
    manualEntryMode,
    eraserToolActive,
    cropToolActive,
    roomOverlay,
    traceInteractionMode,
    viewportSyncTokenRef,
  });

  const activePerimeterOverlay = useMemo(() => {
    return localPerimeterVertices 
      ? { ...perimeterOverlay, vertices: localPerimeterVertices }
      : perimeterOverlay;
  }, [perimeterOverlay, localPerimeterVertices]);

  const activeRoomOverlay = localRoomOverlay || roomOverlay;
  const activeMeasurementLine = localMeasurementLine || currentMeasurementLine;
  const activeCustomShape = currentCustomShape;

  const activePixelsPerFoot = useMemo(() => {
    if (draggingRoomCorner && localRoomOverlay && roomDimensions?.width && roomDimensions?.height) {
      const dimWidth = parseFloat(roomDimensions.width);
      const dimHeight = parseFloat(roomDimensions.height);
      const overlayWidth = Math.abs(localRoomOverlay.x2 - localRoomOverlay.x1);
      const overlayHeight = Math.abs(localRoomOverlay.y2 - localRoomOverlay.y1);
      if (overlayWidth > 0 && overlayHeight > 0) {
        return Math.min(dimWidth, dimHeight) / Math.min(overlayWidth, overlayHeight);
      }
    }
    return pixelsPerFoot;
  }, [draggingRoomCorner, localRoomOverlay, roomDimensions, pixelsPerFoot]);

  const handleEraserPerimeterUpdate = useCallback((nextVertices, isFinal) => {
    if (isFinal) {
      onPerimeterUpdate(nextVertices, true);
      setLocalPerimeterVertices(null);
    } else {
      setLocalPerimeterVertices(nextVertices);
    }
  }, [onPerimeterUpdate]);

  const eraser = useEraserTool({
    perimeterOverlay: activePerimeterOverlay,
    eraserToolActive,
    eraserBrushSize,
    onPerimeterUpdate: handleEraserPerimeterUpdate,
    getCanvasCoords,
  });

  const crop = useCropTool({
    imageObj,
    cropToolActive,
    onImageUpdate,
    onCropToolToggle,
    getCanvasCoords,
  });

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

    const angle = (canvasRotation * Math.PI) / 180;
    const rotatedWidth = Math.abs(Math.cos(angle)) * imgWidth + Math.abs(Math.sin(angle)) * imgHeight;
    const rotatedHeight = Math.abs(Math.sin(angle)) * imgWidth + Math.abs(Math.cos(angle)) * imgHeight;

    const scaleX = containerWidth / rotatedWidth;
    const scaleY = containerHeight / rotatedHeight;
    const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

    // Ensure scale is reasonable
    const clampedScale = Math.max(0.1, Math.min(5, newScale));

    const newX = (containerWidth - imgWidth * clampedScale) / 2;
    const newY = (containerHeight - imgHeight * clampedScale) / 2;

    scaleRef.current = clampedScale;
    setScale(clampedScale);

    // Center the stage
    if (stageRef.current) {
      const stage = stageRef.current;
      stage.scale({ x: clampedScale, y: clampedScale });
      stage.position({ x: newX, y: newY });
      stage.batchDraw();
    }

    // Sync transforms to store using a token
    const token = Math.random();
    viewportSyncTokenRef.current = token;
    setViewportTransform(clampedScale, { x: newX, y: newY }, token);
  }, [imageObj, canvasRotation, setViewportTransform]);

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
          // Read current store transforms on-demand (not reactively)
          const store = useAppStore.getState();
          const currentZoomScale = store.zoomScale;
          const currentStageX = store.stageX;
          const currentStageY = store.stageY;

          // If we already have zoomScale from the store (loaded project or floor switch), restore it
          if (currentZoomScale !== null) {
            scaleRef.current = currentZoomScale;
            setScale(currentZoomScale);

            if (stageRef.current) {
              const stage = stageRef.current;
              stage.scale({ x: currentZoomScale, y: currentZoomScale });
              stage.position({ x: currentStageX, y: currentStageY });
              stage.batchDraw();
            }
            setIsImageReady(true);
            return;
          }

          const containerWidth = containerRef.current.offsetWidth;
          const containerHeight = containerRef.current.offsetHeight;

          // Ensure we have valid container dimensions
          if (containerWidth > 0 && containerHeight > 0) {
            const imgWidth = img.width;
            const imgHeight = img.height;

            const angle = (canvasRotation * Math.PI) / 180;
            const rotatedWidth = Math.abs(Math.cos(angle)) * imgWidth + Math.abs(Math.sin(angle)) * imgHeight;
            const rotatedHeight = Math.abs(Math.sin(angle)) * imgWidth + Math.abs(Math.cos(angle)) * imgHeight;

            const scaleX = containerWidth / rotatedWidth;
            const scaleY = containerHeight / rotatedHeight;
            const newScale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

            // Ensure scale is reasonable
            const clampedScale = Math.max(0.1, Math.min(5, newScale));

            const newX = (containerWidth - imgWidth * clampedScale) / 2;
            const newY = (containerHeight - imgHeight * clampedScale) / 2;

            scaleRef.current = clampedScale;
            setScale(clampedScale);

            if (stageRef.current) {
              const stage = stageRef.current;
              stage.scale({ x: clampedScale, y: clampedScale });
              stage.position({ x: newX, y: newY });
              stage.batchDraw();
            }

            // Sync transforms to store using a token
            const token = Math.random();
            viewportSyncTokenRef.current = token;
            setViewportTransform(clampedScale, { x: newX, y: newY }, token);
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
  }, [image, canvasRotation, setViewportTransform]);

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (angleToolActive && !angleToolState && stageRef.current && contentLayerRef.current) {
      if (hasInitializedRef.current) return;
      hasInitializedRef.current = true;
      const stage = stageRef.current;
      const contentLayer = contentLayerRef.current;
      const screenCenter = { x: stage.width() / 2, y: stage.height() / 2 };
      try {
        const localCenter = contentLayer.getAbsoluteTransform().invert().point(screenCenter);
        const initialDist = 100 / scaleRef.current;
        onAngleToolStateChange?.({
          center: { x: localCenter.x, y: localCenter.y },
          angle1: 0,
          angle2: -Math.PI / 2,
          radius1: initialDist,
          radius2: initialDist,
          visible: true,
          locked: false,
          snapEnabled: true
        });
      } catch (e) {
        console.error(e);
      }
    }
    if (!angleToolActive) {
      hasInitializedRef.current = false;
    }
  }, [angleToolActive, angleToolState, onAngleToolStateChange]);


  useEffect(() => {
    imageSnapAnalyzerRef.current = null;
    imageSnapAnalyzerSourceRef.current = null;
    imageSnapAnalyzerLoadingRef.current = null;
  }, [image]);

  const ensureImageSnapAnalyzer = useCallback(() => {
    if (!autoSnapEnabled || !image) {
      return;
    }

    const hasCurrentAnalyzer =
      imageSnapAnalyzerRef.current &&
      imageSnapAnalyzerSourceRef.current === image;
    if (hasCurrentAnalyzer) {
      return;
    }

    const isCurrentImageLoading =
      imageSnapAnalyzerLoadingRef.current &&
      imageSnapAnalyzerSourceRef.current === image;
    if (isCurrentImageLoading) {
      return;
    }

    imageSnapAnalyzerSourceRef.current = image;
    imageSnapAnalyzerLoadingRef.current = createImageSnapAnalyzer(image)
      .then((analyzer) => {
        // Ignore stale resolutions from previous image values.
        if (imageSnapAnalyzerSourceRef.current !== image) {
          return;
        }
        imageSnapAnalyzerRef.current = analyzer;
      })
      .catch((error) => {
        console.error('Failed to prepare image snap analyzer:', error);
        if (imageSnapAnalyzerSourceRef.current === image) {
          imageSnapAnalyzerRef.current = null;
        }
      })
      .finally(() => {
        if (imageSnapAnalyzerSourceRef.current === image) {
          imageSnapAnalyzerLoadingRef.current = null;
        }
      });
  }, [autoSnapEnabled, image]);

  const findVertexSnapPoint = useCallback((point) => {
    if (!autoSnapEnabled || !point) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findCornerSnap(point);
  }, [autoSnapEnabled, ensureImageSnapAnalyzer]);

  const findVerticalSnap = useCallback((targetX, y1, y2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findVerticalWall(targetX, y1, y2, { searchRadius });
  }, [autoSnapEnabled, ensureImageSnapAnalyzer]);

  const findHorizontalSnap = useCallback((targetY, x1, x2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findHorizontalWall(targetY, x1, x2, { searchRadius });
  }, [autoSnapEnabled, ensureImageSnapAnalyzer]);

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
      const prev = prevImageDimsRef.current;
      const sameSize =
        prev &&
        prev.width === imageObj.width &&
        prev.height === imageObj.height;

      // Only refit when the image dimensions genuinely changed (new file loaded).
      // Skip when the same-size image is produced by the eraser or crop tools,
      // so those tools don't snap the canvas position back to center.
      if (!sameSize) {
        prevImageDimsRef.current = { width: imageObj.width, height: imageObj.height };
        // Small delay to ensure the layout is stable
        const timeoutId = setTimeout(() => {
          fitToWindow();
        }, 100);
        return () => clearTimeout(timeoutId);
      }
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
  // Sync stage transform from store when store values change (e.g. on floor switch or project load)
  useEffect(() => {
    if (viewportSyncToken && viewportSyncToken === viewportSyncTokenRef.current) {
      viewportSyncTokenRef.current = null; // consume token
      return;
    }

    const stage = stageRef.current;
    if (!stage || zoomScale === null) return;

    const currentScale = stage.scaleX();
    const currentX = stage.x();
    const currentY = stage.y();

    const scaleDiff = Math.abs(currentScale - zoomScale);
    const xDiff = Math.abs(currentX - stageX);
    const yDiff = Math.abs(currentY - stageY);

    // If they differ significantly, sync them imperatively
    if (scaleDiff > 0.001 || xDiff > 0.1 || yDiff > 0.1) {
      scaleRef.current = zoomScale;
      setScale(zoomScale);
      stage.scale({ x: zoomScale, y: zoomScale });
      stage.position({ x: stageX, y: stageY });
      stage.batchDraw();
    }
  }, [zoomScale, stageX, stageY, viewportSyncToken]);

  const rotateCanvas = useCallback((direction = 'clockwise') => {
    const delta = direction === 'counterclockwise' ? -45 : 45;
    const nextRotation = (canvasRotation + delta + 360) % 360;
    setCanvasRotation(nextRotation);
  }, [canvasRotation, setCanvasRotation]);

  // Expose canvas viewport controls
  useImperativeHandle(ref, () => ({
    fitToWindow: () => fitToWindow(),
    rotateCanvas,
  }), [fitToWindow, rotateCanvas]);

  // getCanvasCoords is defined above near the hook declarations.

  // Handle room overlay dragging (move entire overlay)
  const handleRoomMouseDown = useCallback((e) => {
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

    if (autoSnapEnabled) {
      ensureImageSnapAnalyzer();
    }
    
    setLocalRoomOverlay(roomOverlay);
    setDraggingRoom(true);
    if (canvasPos) {
      setRoomStart(canvasPos);
    }
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureImageSnapAnalyzer, onSaveUndoPoint]);

  // Handle room corner dragging (with snapping)
  const handleRoomCornerMouseDown = useCallback((corner, e) => {
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

    if (autoSnapEnabled) {
      ensureImageSnapAnalyzer();
    }
    
    setLocalRoomOverlay(roomOverlay);
    setDraggingRoomCorner(corner);
  }, [roomOverlay, getCanvasCoords, autoSnapEnabled, ensureImageSnapAnalyzer, onSaveUndoPoint]);

  // Handle perimeter vertex dragging (no snapping)
  const handleVertexDragStart = useCallback((index) => {
    if (!perimeterOverlay) return;
    
    // Save undo point BEFORE any drag changes (state still reflects pre-drag position)
    onSaveUndoPoint?.();
    
    lastDraggedVertexRef.current = index;
    lastDragStartPosRef.current = { ...perimeterOverlay.vertices[index] };

    if (autoSnapEnabled) {
      ensureImageSnapAnalyzer();
    }
    
    setDraggingVertex(index);
  }, [perimeterOverlay, autoSnapEnabled, ensureImageSnapAnalyzer, onSaveUndoPoint]);

  // Line-by-line port from PerimeterOverlayControl.xaml.cs:Vertex_MouseUp
  const handleVertexDragEnd = useCallback((index, e) => {
    // Get current position from Konva node's actual dragged coordinates in parent space
    const currentVertex = { x: e.target.x(), y: e.target.y() };
    
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
  }, [perimeterOverlay, autoSnapEnabled, findVertexSnapPoint, onPerimeterUpdate, onCancelUndoSave]);

  const handleMeasurementLineSelect = useCallback((index, e) => {
    e.cancelBubble = true;
    setSelectedMeasurementLineIndex(index);
    setSelectedCustomShapeIndex(null);
  }, []);

  const handleCustomShapeSelect = useCallback((index, e) => {
    e.cancelBubble = true;
    setSelectedCustomShapeIndex(index);
    setSelectedMeasurementLineIndex(null);
  }, []);

  const handleMeasurementLineDragEnd = useCallback((index, e) => {
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
  }, [measurementLines, onMeasurementLinesChange]);

  const handleCustomShapeDragEnd = useCallback((index, e) => {
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
  }, [customShapes, onCustomShapesChange]);

  // Eraser and crop tool logic live in useEraserTool / useCropTool (see hook calls above).

  // Handle double-click to close custom shape or add perimeter vertex
  const handleStageDoubleClick = (e) => {
    // IMPORTANT: Only respond to LEFT double-click (button 0)
    if (e.evt && e.evt.button !== 0) return;

    // Line tool: a double click finishes the line
    const storeCurrentLine = useAppStore.getState().currentMeasurementLine;
    if (lineToolActive && storeCurrentLine && storeCurrentLine.start) {
      const stage = e.target.getStage();
      if (!stage) return;
      const finalPoint = getCanvasCoords(stage);
      if (!finalPoint) return;

      const newLine = { start: storeCurrentLine.start, end: finalPoint };
      onAddMeasurementLine(newLine);
      onMeasurementLineUpdate(null); // Reset for next line
      return;
    }

    // Draw area tool - close the shape
    const storeCustomShape = useAppStore.getState().currentCustomShape;
    if (drawAreaActive && storeCustomShape && !storeCustomShape.closed && storeCustomShape.vertices.length >= 3) {
      const finalShape = { ...storeCustomShape, closed: true };
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
  const handleStageMouseMove = useCallback((e) => {
    const stage = e.target.getStage();
    if (!stage) return;
    
    const mousePoint = getCanvasCoords(stage);
    if (!mousePoint) return;
    
    // Only update global crosshair position if we are NOT dragging and a tool that needs it is active.
    // This prevents a full Canvas re-render just from moving the mouse during normal operation.
    const needsMousePos = eraserToolActive || 
      (drawAreaActive && currentCustomShape && currentCustomShape.vertices.length > 0) || 
      (traceInteractionMode === 'drawing' && perimeterVertices && perimeterVertices.length > 0);

    if (needsMousePos && !draggingVertex && !draggingRoom && !draggingRoomCorner) {
      setCurrentMousePos(mousePoint);
    }

    // Eraser tool: continuous erase during drag
    if (eraserToolActive && eraser.isErasingRef.current) {
      eraser.handleEraserMouseMove(stage, e.evt.shiftKey);
      return;
    }

    // Crop tool: update selection rectangle during drag
    if (cropToolActive && crop.isCroppingRef.current) {
      crop.handleCropMouseMove(stage);
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
    if (draggingRoom && roomStart && activeRoomOverlay) {
      const deltaX = mousePoint.x - roomStart.x;
      const deltaY = mousePoint.y - roomStart.y;
      
      const movedOverlay = {
        x1: activeRoomOverlay.x1 + deltaX,
        y1: activeRoomOverlay.y1 + deltaY,
        x2: activeRoomOverlay.x2 + deltaX,
        y2: activeRoomOverlay.y2 + deltaY,
        // Translate polygon along with the bounding rect so the outline stays in sync
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
    
    // Handle room corner dragging with local edge scans while resizing.
    // Holding Shift disables auto-snapping for precise placement.
    if (draggingRoomCorner && activeRoomOverlay) {
      // Only copy coordinates (and confidence metadata) — resizing invalidates
      // the detected polygon boundary so it is intentionally not preserved.
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

    // Custom shape preview
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
    perimeterOverlay,
    perimeterVertices,
    roomOverlay,
    draggingVertex,
  ]);
  
  // Handle global mouse up
  const handleStageMouseUp = () => {
    // Eraser tool: commit the erased image
    if (eraser.isErasingRef.current) {
      eraser.handleEraserMouseUp();
      return;
    }

    // Crop tool: apply the crop
    if (crop.isCroppingRef.current) {
      crop.handleCropMouseUp(crop.cropSelection);
      return;
    }

    if (draggingRoom && localRoomOverlay) {
      onRoomOverlayUpdate?.(localRoomOverlay, false);
      if (lastRoomDragStartRef.current && roomOverlay) {
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
      setLocalRoomOverlay(null);
      setRoomStart(null);
      lastRoomDragStartRef.current = null;
    }
    if (draggingRoomCorner && localRoomOverlay) {
      onRoomOverlayUpdate?.(localRoomOverlay, false);
      if (lastRoomDragStartRef.current && roomOverlay) {
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
      (traceInteractionMode === 'drawing' && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== null) ||
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
      if (traceInteractionMode === 'drawing' && !lineToolActive && !drawAreaActive && onAddPerimeterVertex && perimeterVertices !== null) {
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

        const storeCurrentLine = useAppStore.getState().currentMeasurementLine;

        if (!storeCurrentLine) {
          // Start a new line
          onMeasurementLineUpdate({ start: clickPoint, end: clickPoint });
        } else {
          // Finish the current line
          const newLine = { start: storeCurrentLine.start, end: clickPoint };
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

        const storeCustomShape = useAppStore.getState().currentCustomShape;

        if (!storeCustomShape) {
          // Start a new shape
          onCustomShapeUpdate({ vertices: [clickPoint], closed: false });
        } else {
          // Check if closing the shape by clicking the first vertex
          const firstVertex = storeCustomShape.vertices[0];
          const distance = Math.sqrt(Math.pow(clickPoint.x - firstVertex.x, 2) + Math.pow(clickPoint.y - firstVertex.y, 2));

          if (storeCustomShape.vertices.length > 2 && distance < 10 / scaleRef.current) {
            // Close the shape
            const finalShape = { ...storeCustomShape, closed: true };
            onAddCustomShape(finalShape);
            onCustomShapeUpdate(null); // Reset for next shape
          } else {
            // Add a new vertex
            const newVertices = [...storeCustomShape.vertices, clickPoint];
            onCustomShapeUpdate({ ...storeCustomShape, vertices: newVertices });
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

    if (cropToolActive && crop.isCroppingRef.current) {
      crop.resetCropState();
      return;
    }

    if (lineToolActive && currentMeasurementLine && onMeasurementLineUpdate) {
      onMeasurementLineUpdate(null);
    }
  };
  

  // Clean up click disambiguation timer on unmount
  // (zoom timer cleanup is handled inside useCanvasZoom)
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  // Handle mouseup outside the canvas to commit eraser/crop operations
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (eraser.isErasingRef.current) {
        eraser.handleEraserMouseUp();
      }
      if (crop.isCroppingRef.current) {
        crop.handleCropMouseUp(crop.cropSelection);
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [eraser, crop]);

  // handleWheel, handleStageDragStart, handleStageDragEnd come from useCanvasZoom / useCanvasPan above.

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
        eraser.cancelErase();
      } else if (cropToolActive) {
        // Cancel any in-progress crop selection
        crop.resetCropState();
      } else if (lineToolActive && onLineToolToggle) {
        onLineToolToggle();
      } else if (drawAreaActive && onDrawAreaToggle) {
        onDrawAreaToggle();
      } else if (angleToolActive && onAngleToolToggle) {
        onAngleToolToggle();
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
    eraser,
    crop,
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

  // canPanCanvas comes from useCanvasPan above.

  const contentTransform = useMemo(() => {
    const cx = imageObj ? imageObj.width / 2 : 0;
    const cy = imageObj ? imageObj.height / 2 : 0;
    return {
      x: cx,
      y: cy,
      offsetX: cx,
      offsetY: cy,
      rotation: canvasRotation,
    };
  }, [imageObj, canvasRotation]);

  // Dev-only Konva draw-call instrumentation
  useEffect(() => {
    if (import.meta.env?.DEV) {
      const bLayer = backgroundImageLayerRef.current;
      if (bLayer) {
        const origDraw = bLayer.draw;
        bLayer.draw = function(...args) {
          console.log('[Konva] Background Image Layer Draw Call');
          return origDraw.apply(this, args);
        };
      }
      const cLayer = contentLayerRef.current;
      if (cLayer) {
        const origDraw = cLayer.draw;
        cLayer.draw = function(...args) {
          console.log('[Konva] Content Layer Draw Call');
          return origDraw.apply(this, args);
        };
      }
    }
  }, [isImageReady]);

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

      {imageObj && (
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onWheel={handleWheel}
          draggable={canPanCanvas}
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
          {/* Background Image Layer - completely non-interactive for performance */}
          {isImageReady && (
            <Layer ref={backgroundImageLayerRef} {...contentTransform} listening={false}>
              <KonvaImage
                image={imageObj}
                x={0}
                y={0}
              />
            </Layer>
          )}

          <Layer ref={contentLayerRef} {...contentTransform}>
            {/* Room Overlay - Rendered below the exterior wall (perimeter) overlay */}
            <RoomOverlayLayer
              roomOverlay={activeRoomOverlay}
              scale={scale}
              debugDetection={debugDetection}
              onRoomMouseDown={handleRoomMouseDown}
              onRoomCornerMouseDown={handleRoomCornerMouseDown}
            />

            {/* Perimeter Overlay - Outline and vertices with side-length labels (on top of room overlay) */}
            <PerimeterLayer
              perimeterTraces={perimeterTraces}
              activeTraceId={activeTraceId}
              localPerimeterVertices={localPerimeterVertices}
              scale={scale}
              showSideLengths={showSideLengths}
              pixelsPerFoot={activePixelsPerFoot}
              detectedDimensions={detectedDimensions}
              unit={unit}
              draggingVertex={draggingVertex}
              onVertexDragStart={handleVertexDragStart}
              onVertexDragEnd={handleVertexDragEnd}
              onDeletePerimeterVertex={onDeletePerimeterVertex}
            />

            {debugDetection && (
              <DetectionDebugOverlay
                debugData={detectionDebugData}
                scale={scale}
              />
            )}

            {debugDetection && detectionDebugData?.dominantAngles?.length > 0 && (
              <Text
                x={10}
                y={34}
                text={`Angles: ${detectionDebugData.dominantAngles.join(', ')}`}
                fontSize={12 / scale}
                fill="#8BE9FD"
                rotation={-canvasRotation}
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
                rotation={-canvasRotation}
              />
            )}
            
            {/* Perimeter Vertex Placement Mode */}
            <PerimeterPlacementLayer
              roomOverlay={activeRoomOverlay}
              traceInteractionMode={traceInteractionMode}
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
            layerProps={contentTransform}
            measurementLines={measurementLines}
            currentMeasurementLine={activeMeasurementLine}
            lineToolActive={lineToolActive}
            scale={scale}
            pixelsPerFoot={activePixelsPerFoot}
            unit={unit}
            unitStyle={unitStyle}
            selectedMeasurementLineIndex={selectedMeasurementLineIndex}
            onMeasurementLineSelect={handleMeasurementLineSelect}
            onMeasurementLineDragEnd={handleMeasurementLineDragEnd}
            onMeasurementLinesChange={onMeasurementLinesChange}
          />

          {/* Custom Shapes & Preview */}
          <ShapeLayer
            layerProps={contentTransform}
            customShapes={customShapes}
            currentCustomShape={activeCustomShape}
            currentMousePos={currentMousePos}
            drawAreaActive={drawAreaActive}
            scale={scale}
            pixelsPerFoot={activePixelsPerFoot}
            unit={unit}
            unitStyle={unitStyle}
            selectedCustomShapeIndex={selectedCustomShapeIndex}
            onCustomShapeSelect={handleCustomShapeSelect}
            onCustomShapeDragEnd={handleCustomShapeDragEnd}
          />

          {/* Angle measurement overlay */}
          <Layer
            visible={angleToolActive && !!angleToolState}
            listening={angleToolActive}
            {...contentTransform}
          >
            <AngleOverlay
              angleToolState={angleToolState}
              onAngleToolStateChange={onAngleToolStateChange}
              scale={scale}
              canvasRotation={canvasRotation}
              perimeterTraces={perimeterTraces}
              customShapes={customShapes}
              measurementLines={measurementLines}
              autoSnapEnabled={autoSnapEnabled}
              findVertexSnapPoint={findVertexSnapPoint}
              onDragStateChange={setDraggingAngle}
            />
          </Layer>

          {/* Eraser cursor and crop selection overlay */}
          <Layer listening={false} {...contentTransform}>
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
            {cropToolActive && crop.cropSelection && (() => {
              const sel = crop.cropSelection;
              const sx = Math.min(sel.x1, sel.x2);
              const sy = Math.min(sel.y1, sel.y2);
              const sw = Math.abs(sel.x2 - sel.x1);
              const sh = Math.abs(sel.y2 - sel.y1);
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
