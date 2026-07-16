import React, { forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Group, Circle } from 'react-konva';
import useAppStore from '../store/appStore';
import { RoomOverlayLayer, PerimeterLayer, MeasurementLayer, ShapeLayer, DimensionOverlay, PerimeterPlacementLayer, AngleOverlay, getCanvasCoordinates } from './canvas/index.js';
import { useEraserTool } from '../hooks/useEraserTool';
import { useCropTool } from '../hooks/useCropTool';
import { getUnitStyleFromDimensions } from '../utils/unitConverter';

// Sub-system Hooks
import { useCameraController } from './canvas/hooks/useCameraController';
import { useSnappingSystem } from './canvas/hooks/useSnappingSystem';
import { usePerimeterEditor } from './canvas/hooks/usePerimeterEditor';
import { useShapeEditor } from './canvas/hooks/useShapeEditor';
import { useMeasurementSystem } from './canvas/hooks/useMeasurementSystem';
import { useToolRouter } from './canvas/hooks/useToolRouter';

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
  feetPerPixel,
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
  onClosePerimeter,
  onDeletePerimeterVertex,
  onLineToolToggle,
  autoSnapEnabled,
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
  const prevImageDimsRef = useRef(null);

  // Zustand visual transform selectors
  const zoomScale = useAppStore((s) => s.zoomScale);
  const stageX = useAppStore((s) => s.stageX);
  const stageY = useAppStore((s) => s.stageY);
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  const viewportSyncToken = useAppStore((s) => s.viewportSyncToken);
  const setViewportTransform = useAppStore((s) => s.setViewportTransform);
  const setCanvasRotation = useAppStore((s) => s.setCanvasRotation);

  // Shared refs to break mutual dependencies between hooks
  const cameraRef = useRef(null);
  const measurementRef = useRef(null);
  const shapeRef = useRef(null);
  const perimeterRef = useRef(null);
  const routerRef = useRef(null);

  // Helper to convert screen coordinates to canvas (image) coordinates
  const getCanvasCoords = useCallback(
    (stage) => getCanvasCoordinates(stage, cameraRef.current ? cameraRef.current.scaleRef : { current: 1 }, contentLayerRef),
    []
  );

  // ── 1. Snapping System ─────────────────────────────────────────────────────
  const snapper = useSnappingSystem({
    autoSnapEnabled,
    image,
  });

  // ── 2. Camera Controller ───────────────────────────────────────────────────
  const camera = useCameraController({
    image,
    stageRef,
    containerRef,
    canvasRotation,
    setViewportTransform,
    setCanvasRotation,
    zoomScale,
    stageX,
    stageY,
    viewportSyncToken,
    manualEntryMode,
    eraserToolActive,
    cropToolActive,
    traceInteractionMode,
    draggingRoom: routerRef.current?.draggingRoom ?? false,
    draggingRoomCorner: routerRef.current?.draggingRoomCorner ?? null,
    draggingVertex: perimeterRef.current?.draggingVertex ?? null,
    draggingAngle: routerRef.current?.draggingAngle ?? false,
    isDraggingRef: routerRef.current?.isDraggingRef ?? { current: false },
    dragStartPosRef: routerRef.current?.dragStartPosRef ?? { current: null },
  });

  // ── 3. Eraser Tool ─────────────────────────────────────────────────────────
  const activePerimeterOverlay = useMemo(() => {
    return perimeterRef.current?.localPerimeterVertices 
      ? { ...perimeterOverlay, vertices: perimeterRef.current.localPerimeterVertices }
      : perimeterOverlay;
  }, [perimeterOverlay]);

  const eraser = useEraserTool({
    perimeterOverlay: activePerimeterOverlay,
    eraserToolActive,
    eraserBrushSize,
    onPerimeterUpdate: useCallback((nextVertices, isFinal) => {
      if (isFinal) {
        onPerimeterUpdate(nextVertices, true);
        perimeterRef.current?.setLocalPerimeterVertices(null);
      } else {
        perimeterRef.current?.setLocalPerimeterVertices(nextVertices);
      }
    }, [onPerimeterUpdate]),
    getCanvasCoords,
  });

  // ── 4. Crop Tool ───────────────────────────────────────────────────────────
  const crop = useCropTool({
    imageObj: camera.imageObj,
    cropToolActive,
    onImageUpdate,
    onCropToolToggle,
    getCanvasCoords,
  });

  // ── 5. Measurement System ──────────────────────────────────────────────────
  const measurement = useMeasurementSystem({
    measurementLines,
    onMeasurementLinesChange,
    setSelectedCustomShapeIndex: useCallback((val) => shapeRef.current?.setSelectedCustomShapeIndex(val), []),
  });

  // ── 6. Shape Editor ────────────────────────────────────────────────────────
  const shape = useShapeEditor({
    customShapes,
    onCustomShapesChange,
    setSelectedMeasurementLineIndex: useCallback((val) => measurementRef.current?.setSelectedMeasurementLineIndex(val), []),
  });

  // ── 7. Perimeter Editor ────────────────────────────────────────────────────
  const perimeter = usePerimeterEditor({
    perimeterOverlay,
    perimeterVertices,
    currentMousePos: routerRef.current?.currentMousePos ?? null,
    autoSnapEnabled,
    findVertexSnapPoint: snapper.findVertexSnapPoint,
    traceInteractionMode,
    onPerimeterUpdate,
    onSaveUndoPoint,
    onCancelUndoSave,
    setPerimeterVertices: useCallback((v) => useAppStore.getState().setPerimeterVertices(v), []),
    onClosePerimeter,
  });

  // ── 8. Tool Router ─────────────────────────────────────────────────────────
  const router = useToolRouter({
    stageRef,
    contentLayerRef,
    scaleRef: camera.scaleRef,
    eraserToolActive,
    cropToolActive,
    lineToolActive,
    drawAreaActive,
    angleToolActive,
    manualEntryMode,
    traceInteractionMode,
    autoSnapEnabled,
    viewportSyncTokenRef: camera.viewportSyncTokenRef,
    
    // Snapping
    findVertexSnapPoint: snapper.findVertexSnapPoint,
    snapRoomOverlayMove: snapper.snapRoomOverlayMove,
    snapRoomOverlayResize: snapper.snapRoomOverlayResize,
    ensureWallSnapEngine: snapper.ensureWallSnapEngine,

    // Perimeter
    perimeterOverlay,
    perimeterVertices,
    draggingVertex: perimeter.draggingVertex,
    handleClosePerimeter: perimeter.handleClosePerimeter,
    handleAddPerimeterVertex: perimeter.handleAddPerimeterVertex,
    handleInsertPerimeterVertex: perimeter.handleInsertPerimeterVertex,

    // Shape
    customShapes,
    currentCustomShape,
    selectedCustomShapeIndex: shape.selectedCustomShapeIndex,
    setSelectedCustomShapeIndex: shape.setSelectedCustomShapeIndex,
    onAddCustomShape,
    onCustomShapeUpdate,

    // Measurement
    measurementLines,
    currentMeasurementLine,
    selectedMeasurementLineIndex: measurement.selectedMeasurementLineIndex,
    setSelectedMeasurementLineIndex: measurement.setSelectedMeasurementLineIndex,
    onAddMeasurementLine,
    onMeasurementLineUpdate,

    // Eraser & Crop
    eraser,
    crop,

    // Callbacks
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
  });

  // ── 9. Keep refs in sync after every render ────────────────────────────────
  useEffect(() => {
    cameraRef.current = camera;
    measurementRef.current = measurement;
    shapeRef.current = shape;
    perimeterRef.current = perimeter;
    routerRef.current = router;
  });

  // Center stage when a new image is loaded
  useEffect(() => {
    if (camera.imageObj && camera.dimensions.width > 0 && camera.dimensions.height > 0) {
      const prev = prevImageDimsRef.current;
      const sameSize = prev && prev.width === camera.imageObj.width && prev.height === camera.imageObj.height;

      if (!sameSize) {
        prevImageDimsRef.current = { width: camera.imageObj.width, height: camera.imageObj.height };
        const timeoutId = setTimeout(() => {
          camera.fitToWindow();
        }, 100);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [camera.dimensions, camera.imageObj, camera.fitToWindow]);

  // Expose canvas viewport controls
  useImperativeHandle(ref, () => ({
    fitToWindow: () => camera.fitToWindow(),
    rotateCanvas: (direction) => camera.rotateCanvas(direction),
  }), [camera]);

  // Angle tool auto-initialization at screen center
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
        const initialDist = 100 / camera.scaleRef.current;
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
  }, [angleToolActive, angleToolState, onAngleToolStateChange, camera.scaleRef]);

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
  }, [camera.isImageReady]);

  // Compute unit labels and active feet-per-pixel ratio
  const unitStyle = useMemo(() => getUnitStyleFromDimensions(detectedDimensions, unit), [detectedDimensions, unit]);

  const activeFeetPerPixel = useMemo(() => {
    if (router.draggingRoomCorner && router.localRoomOverlay && roomDimensions?.width && roomDimensions?.height) {
      const dimWidth = parseFloat(roomDimensions.width);
      const dimHeight = parseFloat(roomDimensions.height);
      const overlayWidth = Math.abs(router.localRoomOverlay.x2 - router.localRoomOverlay.x1);
      const overlayHeight = Math.abs(router.localRoomOverlay.y2 - router.localRoomOverlay.y1);
      if (overlayWidth > 0 && overlayHeight > 0 && !isNaN(dimWidth) && !isNaN(dimHeight)) {
        return {
          x: dimWidth / overlayWidth,
          y: dimHeight / overlayHeight
        };
      }
    }
    if (typeof feetPerPixel === 'number') {
      return { x: feetPerPixel, y: feetPerPixel };
    }
    return feetPerPixel;
  }, [router.draggingRoomCorner, router.localRoomOverlay, roomDimensions, feetPerPixel]);

  const contentTransform = useMemo(() => {
    const cx = camera.imageObj ? camera.imageObj.width / 2 : 0;
    const cy = camera.imageObj ? camera.imageObj.height / 2 : 0;
    return {
      x: cx,
      y: cy,
      offsetX: cx,
      offsetY: cy,
      rotation: canvasRotation,
    };
  }, [camera.imageObj, canvasRotation]);

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

      {camera.imageObj && (
        <Stage
          ref={stageRef}
          width={camera.dimensions.width}
          height={camera.dimensions.height}
          onWheel={camera.handleWheel}
          draggable={camera.canPanCanvas}
          onDragStart={camera.handleStageDragStart}
          onDragEnd={camera.handleStageDragEnd}
          onMouseDown={router.handleStageMouseDown}
          onClick={router.handleStageClick}
          onTap={router.handleStageClick}
          onContextMenu={router.handleStageContextMenu}
          onMouseMove={router.handleStageMouseMove}
          onMouseUp={router.handleStageMouseUp}
          onDblClick={router.handleStageDoubleClick}
          onDblTap={router.handleStageDoubleClick}
          style={{ cursor: eraserToolActive ? 'none' : cropToolActive ? 'crosshair' : 'default' }}
        >
          {camera.isImageReady && (
            <Layer ref={backgroundImageLayerRef} {...contentTransform} listening={false}>
              <KonvaImage
                image={camera.imageObj}
                x={0}
                y={0}
              />
            </Layer>
          )}

          <Layer ref={contentLayerRef} {...contentTransform}>
            <RoomOverlayLayer
              roomOverlay={router.activeRoomOverlay}
              scale={camera.scale}
              onRoomMouseDown={router.handleRoomMouseDown}
              onRoomCornerMouseDown={router.handleRoomCornerMouseDown}
            />

            <PerimeterLayer
              perimeterTraces={perimeterTraces}
              activeTraceId={activeTraceId}
              scale={camera.scale}
              showSideLengths={showSideLengths}
              feetPerPixel={activeFeetPerPixel}
              detectedDimensions={detectedDimensions}
              unit={unit}
              draggingVertex={perimeter.draggingVertex}
              onVertexDragStart={perimeter.handleVertexDragStart}
              onVertexDragMove={perimeter.handleVertexDragMove}
              onVertexDragEnd={perimeter.handleVertexDragEnd}
              onDeletePerimeterVertex={(index) => {
                if (router.rightClickPannedRef.current) return;
                onDeletePerimeterVertex?.(index);
              }}
              isSelfIntersecting={perimeter.isSelfIntersecting}
            />

            <DimensionOverlay
              mode={mode}
              detectedDimensions={detectedDimensions}
              scale={camera.scale}
              unit={unit}
              stageRef={stageRef}
              onDimensionSelect={onDimensionSelect}
            />
            
            <PerimeterPlacementLayer
              roomOverlay={router.activeRoomOverlay}
              traceInteractionMode={traceInteractionMode}
              perimeterVertices={perimeterVertices}
              currentMousePos={router.currentMousePos}
              lineToolActive={lineToolActive}
              drawAreaActive={drawAreaActive}
              manualEntryMode={manualEntryMode}
              scale={camera.scale}
              isPreviewInvalid={perimeter.isPreviewInvalid}
            />

            <MeasurementLayer
              measurementLines={measurementLines}
              currentMeasurementLine={router.activeMeasurementLine}
              lineToolActive={lineToolActive}
              scale={camera.scale}
              feetPerPixel={activeFeetPerPixel}
              unit={unit}
              unitStyle={unitStyle}
              selectedMeasurementLineIndex={measurement.selectedMeasurementLineIndex}
              onMeasurementLineSelect={measurement.handleMeasurementLineSelect}
              onMeasurementLineDragEnd={measurement.handleMeasurementLineDragEnd}
              onMeasurementLinesChange={(nextLines) => {
                if (router.rightClickPannedRef.current) return;
                onMeasurementLinesChange?.(nextLines);
              }}
            />

            <ShapeLayer
              customShapes={customShapes}
              currentCustomShape={currentCustomShape}
              currentMousePos={router.currentMousePos}
              drawAreaActive={drawAreaActive}
              scale={camera.scale}
              feetPerPixel={activeFeetPerPixel}
              unit={unit}
              unitStyle={unitStyle}
              selectedCustomShapeIndex={shape.selectedCustomShapeIndex}
              onCustomShapeSelect={shape.handleCustomShapeSelect}
              onCustomShapeDragEnd={shape.handleCustomShapeDragEnd}
            />

            <Group
              visible={angleToolActive && !!angleToolState}
              listening={angleToolActive}
            >
              <AngleOverlay
                angleToolState={angleToolState}
                onAngleToolStateChange={onAngleToolStateChange}
                scale={camera.scale}
                canvasRotation={canvasRotation}
                perimeterTraces={perimeterTraces}
                customShapes={customShapes}
                measurementLines={measurementLines}
                autoSnapEnabled={autoSnapEnabled}
                findVertexSnapPoint={snapper.findVertexSnapPoint}
                onDragStateChange={router.setDraggingAngle}
              />
            </Group>

            <Group listening={false}>
              {eraserToolActive && router.currentMousePos && (
                <Circle
                  x={router.currentMousePos.x}
                  y={router.currentMousePos.y}
                  radius={eraserBrushSize / 2}
                  stroke="#FF5555"
                  strokeWidth={2 / camera.scale}
                  fill="rgba(255, 85, 85, 0.15)"
                  dash={[4 / camera.scale, 4 / camera.scale]}
                  listening={false}
                />
              )}

              {cropToolActive && crop.cropSelection && (() => {
                const sel = crop.cropSelection;
                const sx = Math.min(sel.x1, sel.x2);
                const sy = Math.min(sel.y1, sel.y2);
                const sw = Math.abs(sel.x2 - sel.x1);
                const sh = Math.abs(sel.y2 - sel.y1);
                return (
                  <Rect
                    x={sx}
                    y={sy}
                    width={sw}
                    height={sh}
                    stroke="#8BE9FD"
                    strokeWidth={2 / camera.scale}
                    dash={[6 / camera.scale, 4 / camera.scale]}
                    listening={false}
                  />
                );
              })()}
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  );
}));

Canvas.displayName = 'Canvas';

export default Canvas;
