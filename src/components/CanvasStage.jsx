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
import useAppStore, { selectPickingRoom } from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { RoomOverlayLayer, PerimeterLayer, MeasurementLayer, ScaleLineLayer, ShapeLayer, DimensionOverlay, PerimeterPlacementLayer, DrawModeLayer, AngleOverlay, RefusalHighlightLayer, SpotlightLayer, getCanvasCoordinates } from './canvas/index.js';
import { ACCENT, CRIT, INK, lineColor, withAlpha } from './canvas/overlayStyle';
import { holeRings, isSubtracted } from '../utils/areaCalculator';
import { DEFAULT_TRACE_TYPE, normalizeTraceType } from '../utils/traceTypes';
import { anchorBounds } from '../utils/planAnchors';
import { useCornerEraser } from '../hooks/useEraserTool';
import { useImageEraser } from '../hooks/useImageEraser';
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
  onRoomOverlayUpdate,
  onPerimeterUpdate,
  detectedDimensions,
  onDimensionSelect,
  showSideLengths,
  feetPerPixel,
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
  cornerEraserActive,
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
  const backgroundImageLayerRef = useRef(null);
  const contentLayerRef = useRef(null);
  const prevImageDimsRef = useRef(null);

  // Zustand visual transform selectors
  const zoomScale = useAppStore((s) => s.zoomScale);
  const stageX = useAppStore((s) => s.stageX);
  const stageY = useAppStore((s) => s.stageY);
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  // Read here rather than threaded through App -> Canvas: the scale tool has
  // no callbacks App owns, so a prop chain would be three files of pass-through.
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const scaleLines = useAppStore((s) => s.scaleLines);
  const currentScaleLine = useAppStore((s) => s.currentScaleLine);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const viewportSyncToken = useAppStore((s) => s.viewportSyncToken);
  const setViewportTransform = useAppStore((s) => s.setViewportTransform);
  const setCanvasRotation = useAppStore((s) => s.setCanvasRotation);
  const errorAnchor = useAppStore((s) => s.errorAnchor);
  // Whether the room sizes are on the plan as buttons. Read from the store
  // rather than taken as a prop: it *was* a prop, `mode`, and the one JSX
  // element that passed it stopped doing so — the buttons then never drew, and
  // nothing failed to say so.
  const pickingRoom = useAppStore(selectPickingRoom);
  const annotationSize = useWorkspaceStore((s) => s.annotationSize);

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

  const cornerEraser = useCornerEraser({
    perimeterOverlay: activePerimeterOverlay,
    cornerEraserActive,
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

  // The other eraser: a white brush over the plan itself, for the legend or
  // dimension string that made the trace go wrong in the first place.
  const imageEraser = useImageEraser({
    imageObj: camera.imageObj,
    imageEraserActive: eraserToolActive,
    eraserBrushSize,
    onImageUpdate,
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

    // Erasers, Crop & Draw
    imageEraser,
    cornerEraser,
    cornerEraserActive,
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
        const { x, y } = resolveRoomScale(dimWidth, dimHeight, overlayWidth, overlayHeight);
        return { x, y };
      }
    }
    if (typeof feetPerPixel === 'number') {
      return { x: feetPerPixel, y: feetPerPixel };
    }
    return feetPerPixel;
  }, [router.draggingRoomCorner, router.localRoomOverlay, roomDimensions, feetPerPixel]);

  // `errorAnchor` is where the edit the user just tried was refused — the two
  // edges that would have crossed. Highlight always; move the camera only when
  // the anchor is not already on screen with ~15% padding, and never zoom *in*
  // — the user has framed the plan deliberately.
  useEffect(() => {
    const stage = stageRef.current;
    const layer = contentLayerRef.current;
    const bounds = anchorBounds(errorAnchor);
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
  }, [errorAnchor, setViewportTransform]);

  // What is lit and what is banded, for `SpotlightLayer`. The outline in hand
  // is taken with the dragged corner where the mouse has it, so the lit area
  // grows and shrinks under the drag instead of catching up on release.
  //
  // Off while the plan itself is being worked on — a room being chosen, the
  // outline being painted or its corners placed, a crop, marks being erased.
  // Those are all about the drawing, and a veil over part of it would be
  // dimming the thing the user is reading.
  const spotlightOn = !pickingRoom && !drawModeActive && !cropToolActive
    && !eraserToolActive && traceInteractionMode !== 'drawing';
  const dragIndex = perimeter.draggingVertex;
  const dragCoords = perimeter.draggedVertexCoords;
  const pickedIndex = perimeter.selectedVertexIndex;
  const crossing = perimeter.isSelfIntersecting;
  const spotOutlines = useMemo(() => {
    if (!spotlightOn) return [];
    return (perimeterTraces ?? []).flatMap((t) => {
      if (!t.visible || !(t.vertices?.length >= 3)) return [];
      const active = t.id === activeTraceId;
      let vertices = t.vertices;
      if (active && dragIndex !== null && dragCoords && vertices[dragIndex]) {
        vertices = [...vertices];
        vertices[dragIndex] = dragCoords;
      }
      const held = active ? (dragIndex ?? pickedIndex) : null;
      const n = vertices.length;
      return [{
        vertices,
        // Only the cut-outs that are taken off go back under the veil.
        holes: holeRings((t.holes ?? []).filter(isSubtracted)).filter((ring) => ring?.length >= 3),
        color: active && crossing ? CRIT : lineColor(t.color || ACCENT),
        lit: !!t.closed && normalizeTraceType(t.type) === DEFAULT_TRACE_TYPE,
        emphasis: held !== null && held !== undefined && vertices[held]
          ? [[vertices[(held - 1 + n) % n], vertices[held]], [vertices[held], vertices[(held + 1) % n]]]
          : null,
      }];
    });
  }, [spotlightOn, perimeterTraces, activeTraceId, dragIndex, dragCoords, pickedIndex, crossing]);

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

  // Every layer sizes its labels, handles and strokes as `N / scale` to hold
  // them at N screen pixels. Handing the layers a scale divided by the user's
  // annotation size (Ctrl+wheel) grows or shrinks all of them together without
  // each layer knowing about it. The tool cursors below keep `camera.scale`.
  const overlayScale = camera.scale / annotationSize;

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
          style={{ cursor: (eraserToolActive || cornerEraserActive || drawModeActive) ? 'none' : (cropToolActive || voidToolActive) ? 'crosshair' : 'default' }}
        >
          {camera.isImageReady && (
            <Layer ref={backgroundImageLayerRef} {...contentTransform} listening={false}>
              <KonvaImage
                image={camera.imageObj}
                x={0}
                y={0}
              />
              <SpotlightLayer
                image={camera.imageObj}
                outlines={spotOutlines}
                veil={spotlightOn}
                scale={overlayScale}
              />
            </Layer>
          )}

          <Layer ref={contentLayerRef} {...contentTransform}>
            <RoomOverlayLayer
              roomOverlay={router.activeRoomOverlay}
              scale={overlayScale}
              onRoomMouseDown={router.handleRoomMouseDown}
              onRoomCornerMouseDown={router.handleRoomCornerMouseDown}
            />

            <PerimeterLayer
              image={camera.imageObj}
              perimeterTraces={perimeterTraces}
              activeTraceId={activeTraceId}
              scale={overlayScale}
              showSideLengths={showSideLengths}
              feetPerPixel={activeFeetPerPixel}
              calibrated={!!calibrated}
              quiet={pickingRoom}
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

            <RefusalHighlightLayer anchor={errorAnchor} scale={overlayScale} />

            <DimensionOverlay
              visible={pickingRoom}
              detectedDimensions={detectedDimensions}
              roomOverlay={router.activeRoomOverlay}
              scale={overlayScale}
              unit={unit}
              stageRef={stageRef}
              onDimensionSelect={onDimensionSelect}
            />
            
            <PerimeterPlacementLayer
              traceInteractionMode={traceInteractionMode}
              perimeterVertices={perimeterVertices}
              currentMousePos={router.currentMousePos}
              lineToolActive={lineToolActive}
              drawAreaActive={drawAreaActive}
              scale={overlayScale}
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
              scale={overlayScale}
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
              scale={overlayScale}
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
              scale={overlayScale}
              feetPerPixel={activeFeetPerPixel}
              unit={unit}
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
                scale={overlayScale}
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
              {(eraserToolActive || cornerEraserActive) && router.currentMousePos && (
                <Circle
                  x={router.currentMousePos.x}
                  y={router.currentMousePos.y}
                  radius={eraserBrushSize / 2}
                  stroke={CRIT}
                  strokeWidth={2 / camera.scale}
                  fill={withAlpha(CRIT, 0.12)}
                  dash={[4 / camera.scale, 4 / camera.scale]}
                  listening={false}
                />
              )}

              {drawModeActive && router.currentMousePos && (
                <Circle
                  x={router.currentMousePos.x}
                  y={router.currentMousePos.y}
                  radius={drawBrushSize / 2}
                  stroke={ACCENT}
                  strokeWidth={2 / camera.scale}
                  fill={withAlpha(ACCENT, 0.16)}
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
                    stroke={INK}
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
