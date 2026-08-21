// Everything downstream of `react-konva`, behind Canvas.jsx's React.lazy.
//
// The split is the point: konva + react-konva are 320 kB raw / 99 kB gz, ~42%
// of the initial JS, and not one Konva node is created until an image is
// loaded. `manualChunks` split them into their own file but the entry still
// imported that file statically, so the browser fetched and compiled all of it
// before the app could run.
//
// The cut line is "anything that touches `stageRef`", not just the JSX: React
// does not re-run an effect when a ref is populated, so an effect left in the
// eager shell would fire once against a null stage and never again.
import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Group, Circle } from 'react-konva';
import useAppStore, { roomScaleSamples } from '../store/appStore';
import { RoomOverlayLayer, PerimeterLayer, MeasurementLayer, ScaleLineLayer, ShapeLayer, DimensionOverlay, PerimeterPlacementLayer, DrawModeLayer, AngleOverlay, WarningHighlightLayer, getCanvasCoordinates } from './canvas/index.js';
import { resolveAnchor, anchorBounds } from '../utils/warningAnchors';
import { useEraserTool } from '../hooks/useEraserTool';
import { useCropTool } from '../hooks/useCropTool';
import { useDrawTool } from '../hooks/useDrawTool';
import { useVoidTool } from '../hooks/useVoidTool';
import { getUnitStyleFromDimensions } from '../utils/unitConverter';
import { resolveRoomScale } from '../utils/detection/validate';

// Sub-system Hooks
import { useCameraController } from './canvas/hooks/useCameraController';
import { useSnappingSystem } from './canvas/hooks/useSnappingSystem';
import { usePerimeterEditor } from './canvas/hooks/usePerimeterEditor';
import { useShapeEditor } from './canvas/hooks/useShapeEditor';
import { useMeasurementSystem } from './canvas/hooks/useMeasurementSystem';
import { useToolRouter } from './canvas/hooks/useToolRouter';

const CanvasStage = React.memo(({
  containerRef,
  apiRef,
  image,
  roomOverlay,
  perimeterOverlay,
  perimeterTraces,
  activeTraceId,
  traceInteractionMode,
  mode,
  onRoomOverlayUpdate,
  onPerimeterUpdate,
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
  drawModeActive,
  drawBrushSize,
  drawStrokes,
  onDrawModeToggle,
  onFinishDrawMode,
  voidToolActive,
  onVoidToolToggle,
}) => {
  const stageRef = useRef(null);
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
  const rooms = useAppStore((s) => s.rooms);
  // Read here rather than threaded through App -> Canvas: the scale tool has
  // no callbacks App owns, so a prop chain would be three files of pass-through.
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const scaleLines = useAppStore((s) => s.scaleLines);
  const currentScaleLine = useAppStore((s) => s.currentScaleLine);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const viewportSyncToken = useAppStore((s) => s.viewportSyncToken);
  const setViewportTransform = useAppStore((s) => s.setViewportTransform);
  const setCanvasRotation = useAppStore((s) => s.setCanvasRotation);
  const focusedWarning = useAppStore((s) => s.focusedWarning);
  const errorAnchor = useAppStore((s) => s.errorAnchor);

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
    drawModeActive,
    cropToolActive,
    voidToolActive,
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

  // ── 3b. Draw Tool ──────────────────────────────────────────────────────────
  const drawTool = useDrawTool({ drawModeActive, getCanvasCoords });

  // ── 4. Crop Tool ───────────────────────────────────────────────────────────
  const crop = useCropTool({
    imageObj: camera.imageObj,
    cropToolActive,
    onImageUpdate,
    onCropToolToggle,
    getCanvasCoords,
  });

  // ── 4b. Void Tool ──────────────────────────────────────────────────────────
  const voidTool = useVoidTool({
    voidToolActive,
    getCanvasCoords,
    scaleRef: camera.scaleRef,
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
    drawModeActive,
    scaleToolActive,
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
    selectedVertexIndex: perimeter.selectedVertexIndex,
    setSelectedVertexIndex: perimeter.setSelectedVertexIndex,
    onDeletePerimeterVertex,
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

    // Scale line
    currentScaleLine,

    // Eraser, Crop & Draw
    eraser,
    crop,
    drawTool,
    onDrawModeToggle,
    onFinishDrawMode,

    // Void
    voidToolActive,
    voidTool,
    onVoidToolToggle,

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

  // Centre the stage when a *new* image is loaded — not when this component
  // mounts over an image it has already been told where to look at.
  //
  // `prevImageDimsRef` is null on every mount, so `sameSize` was false and the
  // fit always fired 100 ms later, throwing away the camera that
  // `useCameraController` had just restored from the draft or the `.floorplan`.
  // The symptom was a view that settled and then jumped, on every project open.
  // First sight of an image therefore only fits when there is no stored camera
  // to honour; a genuine change of image dimensions still fits unconditionally.
  useEffect(() => {
    if (!camera.imageObj || camera.dimensions.width <= 0 || camera.dimensions.height <= 0) return;

    const prev = prevImageDimsRef.current;
    const dims = { width: camera.imageObj.width, height: camera.imageObj.height };
    if (prev && prev.width === dims.width && prev.height === dims.height) return;

    const isFirstSight = prev === null;
    prevImageDimsRef.current = dims;
    if (isFirstSight && useAppStore.getState().zoomScale !== null) return;

    const timeoutId = setTimeout(() => {
      camera.fitToWindow();
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [camera.dimensions, camera.imageObj, camera.fitToWindow]);

  // Publish the viewport controls to the eager shell, which owns the ref the
  // rest of the app holds. Written through a ref rather than returned so
  // `canvasRef.current` is never null while this chunk is still loading.
  useEffect(() => {
    apiRef.current = {
      fitToWindow: () => camera.fitToWindow(),
      rotateCanvas: (direction) => camera.rotateCanvas(direction),
      zoomByStep: (direction) => camera.zoomByStep(direction),
      // Enter closes a void in progress, and a phone has no Enter. The shape
      // lives in this hook's state, so the button that replaces the key has to
      // reach it from here.
      closeVoid: () => voidTool.closeVoidPolygon(),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera, voidTool]);

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

  // Both layers are React.memo'd, and a freshly-allocated arrow prop defeats
  // the memo on every render — which is every pointer event during an eraser,
  // draw, crop or vertex-placement gesture. `routerRef` is already synced after
  // every render (see above), so reading the pan flag through it needs no ref
  // mirror and no surgery inside useToolRouter.
  const handleDeletePerimeterVertex = useCallback((index) => {
    if (routerRef.current?.rightClickPannedRef?.current) return;
    onDeletePerimeterVertex?.(index);
  }, [onDeletePerimeterVertex]);

  const handleMeasurementLinesChange = useCallback((nextLines) => {
    if (routerRef.current?.rightClickPannedRef?.current) return;
    onMeasurementLinesChange?.(nextLines);
  }, [onMeasurementLinesChange]);

  // Read through the refs, which are re-synced after every render, so these
  // three props keep a stable identity — a fresh arrow per render on the Stage
  // is a fresh listener on every pointer event of every gesture.
  const handleTouchStart = useCallback((e) => {
    routerRef.current?.handleStageTouchStart(e);
    cameraRef.current?.handlePinchStart(e);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (cameraRef.current?.handlePinchMove(e)) return;
    routerRef.current?.handleStageTouchMove(e);
  }, []);

  const handleTouchEnd = useCallback((e) => {
    cameraRef.current?.handlePinchEnd(e);
    routerRef.current?.handleStageTouchEnd(e);
  }, []);

  // Compute unit labels and active feet-per-pixel ratio
  const unitStyle = useMemo(() => getUnitStyleFromDimensions(detectedDimensions, unit), [detectedDimensions, unit]);

  const activeFeetPerPixel = useMemo(() => {
    if (router.draggingRoomCorner && router.localRoomOverlay && roomDimensions?.width && roomDimensions?.height) {
      const dimWidth = parseFloat(roomDimensions.width);
      const dimHeight = parseFloat(roomDimensions.height);
      const overlayWidth = Math.abs(router.localRoomOverlay.x2 - router.localRoomOverlay.x1);
      const overlayHeight = Math.abs(router.localRoomOverlay.y2 - router.localRoomOverlay.y1);
      if (overlayWidth > 0 && overlayHeight > 0 && !isNaN(dimWidth) && !isNaN(dimHeight)) {
        // The whole committed rule, not just the pairing half: these are the
        // numbers the drag applies on release, so a wall must not read one
        // length under the mouse and another the moment it is let go.
        const { x, y } = resolveRoomScale(
          dimWidth, dimHeight, overlayWidth, overlayHeight, roomScaleSamples(rooms),
        );
        return { x, y };
      }
    }
    if (typeof feetPerPixel === 'number') {
      return { x: feetPerPixel, y: feetPerPixel };
    }
    return feetPerPixel;
  }, [router.draggingRoomCorner, router.localRoomOverlay, roomDimensions, feetPerPixel, rooms]);

  // The warning the panel is showing, resolved against live state every render
  // rather than read from anything stored — see utils/warningAnchors.js. A
  // focus left on a deleted trace or a re-traced outline resolves to nothing.
  const warningAnchor = useMemo(() => {
    // A refusal the user just triggered outranks a warning they clicked
    // earlier: it describes the edit in front of them.
    if (errorAnchor) return errorAnchor;
    if (!focusedWarning) return null;
    const trace = (perimeterTraces || []).find((t) => t.id === focusedWarning.traceId);
    const warning = trace?.quality?.warnings?.[focusedWarning.index];
    if (!warning) return null;
    return resolveAnchor(warning, {
      trace, traces: perimeterTraces, rooms, detectedDimensions,
    });
  }, [errorAnchor, focusedWarning, perimeterTraces, rooms, detectedDimensions]);

  // Highlight always; move the camera only when the anchor is not already on
  // screen with ~15% padding, and never zoom *in* — the user has framed the
  // plan deliberately, and the anchor is often the whole outline.
  useEffect(() => {
    const stage = stageRef.current;
    const layer = contentLayerRef.current;
    const bounds = anchorBounds(warningAnchor);
    if (!stage || !layer || !bounds) return;

    // Layer-relative, so the canvas rotation is already applied and only the
    // stage's own scale/position remain to be chosen.
    const transform = layer.getTransform();
    const corners = [
      { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
    ].map((p) => transform.point(p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const scale = stage.scaleX();
    const vw = stage.width();
    const vh = stage.height();
    if (!(scale > 0) || !(vw > 0) || !(vh > 0)) return;
    const padX = vw * 0.075;
    const padY = vh * 0.075;
    const visible = stage.x() + scale * minX >= padX
      && stage.x() + scale * maxX <= vw - padX
      && stage.y() + scale * minY >= padY
      && stage.y() + scale * maxY <= vh - padY;
    if (visible) return;

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const target = Math.max(0.1, Math.min(
      scale,
      spanX > 0 ? (vw - 2 * padX) / spanX : Infinity,
      spanY > 0 ? (vh - 2 * padY) / spanY : Infinity,
    ));
    // No sync token: the camera controller's own effect is what applies this
    // to the stage, and it skips any transform it recognises as its own.
    setViewportTransform(target, {
      x: vw / 2 - target * (minX + maxX) / 2,
      y: vh / 2 - target * (minY + maxY) / 2,
    }, null);
  }, [warningAnchor, setViewportTransform]);

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
    <>
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
          // Touch. The router runs first on `start` so a gesture already in
          // progress commits before the pinch takes over, and the pinch runs
          // first on `move` so two fingers are read as the camera rather than
          // as a very fast brush stroke.
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ cursor: (eraserToolActive || drawModeActive) ? 'none' : (cropToolActive || voidToolActive) ? 'crosshair' : 'default' }}
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
              selectedVertexIndex={perimeter.selectedVertexIndex}
              onVertexSelect={perimeter.setSelectedVertexIndex}
              onVertexDragStart={perimeter.handleVertexDragStart}
              onVertexDragMove={perimeter.handleVertexDragMove}
              onVertexDragEnd={perimeter.handleVertexDragEnd}
              onDeletePerimeterVertex={handleDeletePerimeterVertex}
              isSelfIntersecting={perimeter.isSelfIntersecting}
              voidToolActive={voidToolActive}
              voidCandidate={voidTool.candidate}
              selectedHole={router.selectedHole}
              onHoleSelect={router.setSelectedHole}
            />

            <WarningHighlightLayer anchor={warningAnchor} scale={camera.scale} />

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

            <DrawModeLayer
              drawStrokes={drawStrokes}
              currentStroke={drawTool.currentStroke}
              brushSize={drawBrushSize}
              visible={drawModeActive}
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
              onMeasurementLinesChange={handleMeasurementLinesChange}
            />

            <ScaleLineLayer
              scaleLines={scaleLines}
              currentScaleLine={router.activeScaleLine}
              scaleToolActive={scaleToolActive}
              calibrated={calibrated}
              scale={camera.scale}
              feetPerPixel={activeFeetPerPixel}
              unit={unit}
              unitStyle={unitStyle}
              selectedScaleLineIndex={router.selectedScaleLineIndex}
              onScaleLineSelect={router.setSelectedScaleLineIndex}
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

              {drawModeActive && router.currentMousePos && (
                <Circle
                  x={router.currentMousePos.x}
                  y={router.currentMousePos.y}
                  radius={drawBrushSize / 2}
                  stroke="#8BE9FD"
                  strokeWidth={2 / camera.scale}
                  fill="rgba(139, 233, 253, 0.18)"
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
    </>
  );
});

CanvasStage.displayName = 'CanvasStage';

export default CanvasStage;
