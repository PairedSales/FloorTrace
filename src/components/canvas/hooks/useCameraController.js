import { useState, useEffect, useRef, useCallback } from 'react';
import useAppStore from '../../../store/appStore';
import { decodedImage, loadImage } from '../imageCache';
import { useCanvasZoom } from '../../../hooks/useCanvasZoom';
import { useCanvasPan } from '../../../hooks/useCanvasPan';
import { usePinchZoom } from '../../../hooks/usePinchZoom';

export function useCameraController({
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
  draggingRoom = false,
  draggingRoomCorner = null,
  draggingVertex = null,
  draggingAngle = false,
  isDraggingRef = { current: false },
  dragStartPosRef = { current: null },
}) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1); // Track scale imperatively to avoid React reconciliation
  const viewportSyncTokenRef = useRef(null);
  const prevSizeRef = useRef(null); // Last measured container size, for resize recentring

  const [imageObj, setImageObj] = useState(null);
  const [isImageReady, setIsImageReady] = useState(false);

  // Read by the image-load effect but deliberately not a dependency of it.
  // Every 45° rotate used to re-run the whole loader — `setIsImageReady(false)`
  // then a fresh `new Image()` against the full data URL — which unmounts the
  // background Layer, destroys and reallocates two stage-sized canvases, and
  // shows a blank frame. The dependency bought nothing: the only read is in a
  // branch that rotation cannot reach, because `zoomScale` is already non-null
  // by then. A bare dep deletion trips react-hooks/exhaustive-deps, which is on.
  const canvasRotationRef = useRef(canvasRotation);
  canvasRotationRef.current = canvasRotation;

  const { handleWheel, zoomByStep, isZoomingRef } = useCanvasZoom(
    stageRef,
    scaleRef,
    setScale,
    viewportSyncTokenRef
  );

  // The touch counterpart of the wheel. Lives beside it rather than inside the
  // tool router because it is a camera gesture, not a tool one: it must work
  // identically whatever tool is on, including the brush tools that own every
  // single-finger event.
  const pinch = usePinchZoom({ stageRef, scaleRef, setScale, viewportSyncTokenRef });

  const fitToWindow = useCallback(() => {
    if (!imageObj || !containerRef.current) return;

    const containerWidth = containerRef.current.offsetWidth;
    const containerHeight = containerRef.current.offsetHeight;

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

    const token = Math.random();
    viewportSyncTokenRef.current = token;
    setViewportTransform(clampedScale, { x: newX, y: newY }, token);
  }, [imageObj, canvasRotation, setViewportTransform, containerRef, stageRef]);

  const rotateCanvas = useCallback((direction = 'clockwise') => {
    const delta = direction === 'counterclockwise' ? -45 : 45;
    const nextRotation = (canvasRotation + delta + 360) % 360;
    setCanvasRotation(nextRotation);
  }, [canvasRotation, setCanvasRotation]);

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
    drawModeActive,
    cropToolActive,
    voidToolActive,
    traceInteractionMode,
    viewportSyncTokenRef,
    isPinchingRef: pinch.isPinchingRef,
  });

  // Load image
  useEffect(() => {
    if (!image) {
      setImageObj(null);
      setIsImageReady(false);
      return;
    }

    setIsImageReady(false);

    // Already decoded — from this plan before a switch, or from another plan
    // holding the same file. Applied synchronously so returning to a plan does
    // not flash an empty stage while a decode it does not need runs again.
    const cached = decodedImage(image);
    let cancelled = false;

    const settle = (img) => {
      if (cancelled || !img) return;
      setImageObj(img);

      requestAnimationFrame(() => {
        if (containerRef.current && img) {
          const store = useAppStore.getState();
          const currentZoomScale = store.zoomScale;
          const currentStageX = store.stageX;
          const currentStageY = store.stageY;

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

          if (containerWidth > 0 && containerHeight > 0) {
            const imgWidth = img.width;
            const imgHeight = img.height;

            const angle = (canvasRotationRef.current * Math.PI) / 180;
            const rotatedWidth = Math.abs(Math.cos(angle)) * imgWidth + Math.abs(Math.sin(angle)) * imgHeight;
            const rotatedHeight = Math.abs(Math.sin(angle)) * imgWidth + Math.abs(Math.cos(angle)) * imgHeight;

            const scaleX = containerWidth / rotatedWidth;
            const scaleY = containerHeight / rotatedHeight;
            const newScale = Math.min(scaleX, scaleY) * 0.9;

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

            const token = Math.random();
            viewportSyncTokenRef.current = token;
            setViewportTransform(clampedScale, { x: newX, y: newY }, token);
          }
        }
        setIsImageReady(true);
      });
    };

    if (cached) {
      settle(cached);
      return undefined;
    }

    loadImage(image).then(settle).catch(() => {
      if (cancelled) return;
      console.error('Failed to load image');
      setIsImageReady(false);
    });

    // A switch away mid-decode must not land the old plan's image on the new
    // one: the effect re-runs with a different `image`, and the decode it
    // replaced may still resolve afterwards.
    return () => { cancelled = true; };
  }, [image, setViewportTransform, containerRef, stageRef]);

  // Observe container size changes. Resizing the window must not slide the
  // plan: the stage keeps its own origin, so a container that gains width adds
  // all of it on the right and the image drifts left. Shifting the stage by
  // half the delta holds whatever was in the middle of the viewport in the
  // middle of it — a centred image stays centred, and a pan/zoom the user chose
  // is preserved rather than refit.
  // The first measure is synchronous rather than a frame later.
  //
  // `dimensions` seeds at 800x600 and the Stage mounts as soon as there is an
  // image — which, since decoded images are now cached, is the *same commit* on
  // a plan switch. Measuring one animation frame later therefore let Konva
  // build the stage and both layers at 800x600, draw them, and then rebuild and
  // redraw every canvas at the real size: roughly 30-60 MB of throwaway backing
  // store and three redundant full-layer draws per switch, plus one visibly
  // clipped frame.
  //
  // A passive effect, deliberately, NOT `useLayoutEffect`. `containerRef` is
  // owned by the parent (Canvas) and this hook runs in the child: React attaches
  // refs bottom-up in the same traversal that runs layout effects, so a layout
  // effect here sees `containerRef.current === null` on a fresh mount and bails
  // — leaving the stage at 800x600 with no ResizeObserver attached and nothing
  // to recover it. That is what the rAF was really buying, and it is why the
  // keyed remount a plan switch causes is the case that breaks. A passive effect
  // runs after every ref is attached, and still lands before paint for the
  // discrete click that triggered it.
  //
  // The ResizeObserver below stays debounced — that path is about the window
  // changing, where coalescing is what is wanted.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;

      const prev = prevSizeRef.current;
      prevSizeRef.current = { width: w, height: h };
      setDimensions({ width: w, height: h });

      if (!prev || (prev.width === w && prev.height === h)) return;

      const stage = stageRef.current;
      // No camera yet (no image, or the loader hasn't run) — nothing to hold.
      if (!stage || useAppStore.getState().zoomScale === null) return;

      const nextX = stage.x() + (w - prev.width) / 2;
      const nextY = stage.y() + (h - prev.height) / 2;
      stage.position({ x: nextX, y: nextY });
      stage.batchDraw();

      const token = Math.random();
      viewportSyncTokenRef.current = token;
      setViewportTransform(scaleRef.current, { x: nextX, y: nextY }, token);
    };

    measure();

    let resizeTimer = null;
    const debouncedMeasure = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 100);
    };

    const ro = new ResizeObserver(debouncedMeasure);
    ro.observe(el);

    window.addEventListener('resize', debouncedMeasure);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      window.removeEventListener('resize', debouncedMeasure);
    };
  }, [containerRef, stageRef, setViewportTransform]);

  // Stage transform sync
  useEffect(() => {
    if (viewportSyncToken && viewportSyncToken === viewportSyncTokenRef.current) {
      viewportSyncTokenRef.current = null;
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

    if (scaleDiff > 0.001 || xDiff > 0.1 || yDiff > 0.1) {
      scaleRef.current = zoomScale;
      setScale(zoomScale);
      stage.scale({ x: zoomScale, y: zoomScale });
      stage.position({ x: stageX, y: stageY });
      stage.batchDraw();
    }
  }, [zoomScale, stageX, stageY, viewportSyncToken, stageRef]);

  return {
    scale,
    scaleRef,
    dimensions,
    setDimensions,
    fitToWindow,
    rotateCanvas,
    handleWheel,
    zoomByStep,
    canPanCanvas,
    handleStageDragStart,
    handleStageDragEnd,
    viewportSyncTokenRef,
    imageObj,
    isImageReady,
    // Two-finger camera gestures. The stage wires these ahead of the tool
    // router's touch handlers, which bail out on a second finger.
    handlePinchStart: pinch.handleTouchStart,
    handlePinchMove: pinch.handleTouchMove,
    handlePinchEnd: pinch.handleTouchEnd,
    isPinchingRef: pinch.isPinchingRef,
  };
}
