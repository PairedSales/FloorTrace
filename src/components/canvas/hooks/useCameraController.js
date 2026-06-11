import { useState, useEffect, useRef, useCallback } from 'react';
import useAppStore from '../../../store/appStore';
import { useCanvasZoom } from '../../../hooks/useCanvasZoom';
import { useCanvasPan } from '../../../hooks/useCanvasPan';

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
  cropToolActive,
  roomOverlay,
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

  const [imageObj, setImageObj] = useState(null);
  const [isImageReady, setIsImageReady] = useState(false);

  const { handleWheel, isZoomingRef } = useCanvasZoom(
    stageRef,
    scaleRef,
    setScale,
    viewportSyncTokenRef
  );

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
    cropToolActive,
    roomOverlay,
    traceInteractionMode,
    viewportSyncTokenRef,
  });

  // Load image
  useEffect(() => {
    if (!image) {
      setImageObj(null);
      setIsImageReady(false);
      return;
    }

    setIsImageReady(false);
    const img = new window.Image();
    img.onload = () => {
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

            const angle = (canvasRotation * Math.PI) / 180;
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
    img.onerror = () => {
      console.error('Failed to load image');
      setIsImageReady(false);
    };
    img.src = image;
  }, [image, canvasRotation, setViewportTransform, containerRef, stageRef]);

  // Observe container size changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) setDimensions({ width: w, height: h });
    };

    const raf = requestAnimationFrame(measure);

    let resizeTimer = null;
    const debouncedMeasure = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 100);
    };

    const ro = new ResizeObserver(debouncedMeasure);
    ro.observe(el);

    window.addEventListener('resize', debouncedMeasure);

    return () => {
      cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      window.removeEventListener('resize', debouncedMeasure);
    };
  }, [containerRef]);

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
    canPanCanvas,
    handleStageDragStart,
    handleStageDragEnd,
    viewportSyncTokenRef,
    imageObj,
    isImageReady,
  };
}
