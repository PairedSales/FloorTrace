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
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import useAppStore, { selectPickingRoom } from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { RoomOverlayLayer, PerimeterLayer, ScaleLineLayer, DimensionOverlay } from './canvas/index.js';
import { getUnitStyleFromDimensions } from '../utils/unitConverter';

// Sub-system Hooks
import { useCameraController } from './canvas/hooks/useCameraController';
import { useSnappingSystem } from './canvas/hooks/useSnappingSystem';
import { useToolRouter } from './canvas/hooks/useToolRouter';

const CanvasStage = React.memo(({
  containerRef,
  apiRef,
  image,
  roomOverlay,
  perimeterTraces,
  activeTraceId,
  detectedDimensions,
  onDimensionSelect,
  showSideLengths,
  feetPerPixel,
  unit,
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
  // Read here rather than threaded through App -> Canvas: the scale tool has
  // no callbacks App owns, so a prop chain would be three files of pass-through.
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const scaleLines = useAppStore((s) => s.scaleLines);
  const currentScaleLine = useAppStore((s) => s.currentScaleLine);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const viewportSyncToken = useAppStore((s) => s.viewportSyncToken);
  const setViewportTransform = useAppStore((s) => s.setViewportTransform);
  const setCanvasRotation = useAppStore((s) => s.setCanvasRotation);
  // Whether the room sizes are on the plan as buttons. Read from the store
  // rather than taken as a prop: it *was* a prop, `mode`, and the one JSX
  // element that passed it stopped doing so — the buttons then never drew, and
  // nothing failed to say so.
  const pickingRoom = useAppStore(selectPickingRoom);
  const annotationSize = useWorkspaceStore((s) => s.annotationSize);

  // The camera and the router, read through refs by the touch handlers below so
  // those keep a stable identity.
  const cameraRef = useRef(null);
  // Set by the camera while the stage is being dragged, read by the router so
  // the click that ends a pan places nothing.
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef(null);

  // ── 1. Snapping, for the ends of a known length ────────────────────────────
  const snapper = useSnappingSystem({ enabled: scaleToolActive, image });

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
    isDraggingRef,
    dragStartPosRef,
  });

  // ── 3. Pointer ─────────────────────────────────────────────────────────────
  const router = useToolRouter({
    stageRef,
    contentLayerRef,
    scaleRef: camera.scaleRef,
    scaleToolActive,
    currentScaleLine,
    isDraggingRef,
    viewportSyncTokenRef: camera.viewportSyncTokenRef,
    findVertexSnapPoint: snapper.findVertexSnapPoint,
  });

  useEffect(() => {
    cameraRef.current = camera;
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
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera]);

  // Two fingers are the camera. Read through the ref, which is re-synced after
  // every render, so these three props keep a stable identity — a fresh arrow
  // per render on the Stage is a fresh listener on every pointer event.
  const handleTouchStart = useCallback((e) => cameraRef.current?.handlePinchStart(e), []);
  const handleTouchMove = useCallback((e) => cameraRef.current?.handlePinchMove(e), []);
  const handleTouchEnd = useCallback((e) => cameraRef.current?.handlePinchEnd(e), []);

  // Compute unit labels and active feet-per-pixel ratio
  const unitStyle = useMemo(() => getUnitStyleFromDimensions(detectedDimensions, unit), [detectedDimensions, unit]);

  const activeFeetPerPixel = useMemo(() => (
    typeof feetPerPixel === 'number' ? { x: feetPerPixel, y: feetPerPixel } : feetPerPixel
  ), [feetPerPixel]);

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
  // each layer knowing about it.
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ cursor: scaleToolActive ? 'crosshair' : 'default' }}
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
            <RoomOverlayLayer roomOverlay={roomOverlay} scale={overlayScale} />

            <PerimeterLayer
              perimeterTraces={perimeterTraces}
              activeTraceId={activeTraceId}
              scale={overlayScale}
              showSideLengths={showSideLengths}
              feetPerPixel={activeFeetPerPixel}
              detectedDimensions={detectedDimensions}
              unit={unit}
            />

            <DimensionOverlay
              visible={pickingRoom}
              detectedDimensions={detectedDimensions}
              scale={overlayScale}
              unit={unit}
              stageRef={stageRef}
              onDimensionSelect={onDimensionSelect}
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
          </Layer>
        </Stage>
      )}
    </>
  );
});

CanvasStage.displayName = 'CanvasStage';

export default CanvasStage;
