import { useCallback, useEffect, useRef } from 'react';
import useAppStore from '../store/appStore';

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

/**
 * Two-finger zoom and pan for the Konva stage.
 *
 * The wheel is the desktop's zoom and has no touch equivalent, so without this
 * a phone could only ever see the plan at fit-to-window — on a scan whose
 * dimension labels are 12 px tall, that is not a plan you can trace.
 *
 * Zoom and pan are one gesture rather than two, because on a touchscreen they
 * are one movement: the pair of fingers carries both a separation (scale) and a
 * centre (translation), and honouring only the first makes the plan slide out
 * from under the hand. The image point under the initial midpoint is pinned for
 * the whole gesture, so the plan stays welded to the fingers.
 *
 * Rotation is deliberately *not* read from the gesture. This app's rotation is
 * a deliberate 45° alignment step that the tracer, the exported exhibit and
 * every label layout are all built around; a continuous free rotation from a
 * stray thumb would be a different feature wearing the same gesture.
 *
 * Runs entirely on the stage node during the gesture and writes to the store
 * once at the end, matching what the wheel path does and for the same reason:
 * a store write per frame re-renders the whole shell mid-pinch.
 */
export function usePinchZoom({ stageRef, scaleRef, setScale, viewportSyncTokenRef }) {
  const gestureRef = useRef(null);
  const isPinchingRef = useRef(false);
  const rafRef = useRef(null);
  const pendingRef = useRef(null);
  // The 80 ms tail below outlives the gesture by design, so it can also outlive
  // the component. Held in a ref so unmount can cancel it.
  const tailTimerRef = useRef(null);

  const touchPoints = (stage, evt) => {
    const list = evt?.touches;
    if (!list || list.length < 2) return null;
    const rect = stage.container().getBoundingClientRect();
    // Only the first two: a third finger landing mid-pinch must not redefine
    // the gesture, which is what made the plan jump on a palm touch.
    return [0, 1].map((i) => ({
      x: list[i].clientX - rect.left,
      y: list[i].clientY - rect.top,
    }));
  };

  const applyPending = useCallback(() => {
    rafRef.current = null;
    const stage = stageRef.current;
    const next = pendingRef.current;
    if (!stage || !next) return;
    stage.scale({ x: next.scale, y: next.scale });
    stage.position(next.pos);
    stage.batchDraw();
  }, [stageRef]);

  const handleTouchStart = useCallback((e) => {
    const stage = stageRef.current;
    if (!stage) return false;
    const points = touchPoints(stage, e.evt);
    if (!points) return false;

    e.evt.preventDefault();
    // A pinch that begins while one finger is already dragging the stage would
    // otherwise apply both transforms to the same frame.
    if (stage.isDragging()) stage.stopDrag();

    const start = scaleRef.current || stage.scaleX() || 1;
    const pos = stage.position();
    const centre = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    gestureRef.current = {
      distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      scale: start,
      // The image-space point the fingers are holding. Pinned for the gesture.
      anchor: { x: (centre.x - pos.x) / start, y: (centre.y - pos.y) / start },
    };
    isPinchingRef.current = true;
    return true;
  }, [stageRef, scaleRef]);

  const handleTouchMove = useCallback((e) => {
    const stage = stageRef.current;
    const gesture = gestureRef.current;
    if (!stage || !gesture) return false;
    const points = touchPoints(stage, e.evt);
    if (!points) return false;

    e.evt.preventDefault();
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    // Two fingers landing on the same spot is a division by zero, not a zoom.
    if (!(gesture.distance > 0) || !(distance > 0)) return true;

    const centre = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
      gesture.scale * (distance / gesture.distance)));

    scaleRef.current = scale;
    pendingRef.current = {
      scale,
      pos: {
        x: centre.x - gesture.anchor.x * scale,
        y: centre.y - gesture.anchor.y * scale,
      },
    };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(applyPending);
    return true;
  }, [stageRef, scaleRef, applyPending]);

  const handleTouchEnd = useCallback(() => {
    if (!gestureRef.current) return false;
    gestureRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      applyPending();
    }
    pendingRef.current = null;

    const stage = stageRef.current;
    if (stage) {
      const scale = scaleRef.current;
      setScale(scale);
      const token = Math.random();
      if (viewportSyncTokenRef) viewportSyncTokenRef.current = token;
      useAppStore.getState().setViewportTransform(
        scale, { x: stage.x(), y: stage.y() }, token,
      );
    }
    // Held one frame past the gesture: lifting two fingers is never perfectly
    // simultaneous, and the tail of a pinch used to arrive as a one-finger pan
    // that yanked the plan sideways.
    if (tailTimerRef.current) clearTimeout(tailTimerRef.current);
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null;
      isPinchingRef.current = false;
    }, 80);
    return true;
  }, [stageRef, scaleRef, setScale, viewportSyncTokenRef, applyPending]);

  // A system gesture — notification shade, app switcher, an incoming call —
  // delivers `touchcancel` and no `touchend`. Without this the gesture stays
  // open, `isPinchingRef` stays true, and the stage never becomes pannable
  // again: the plan is frozen until reload.
  useEffect(() => {
    const onCancel = () => { if (gestureRef.current) handleTouchEnd(); };
    window.addEventListener('touchcancel', onCancel);
    return () => window.removeEventListener('touchcancel', onCancel);
  }, [handleTouchEnd]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (tailTimerRef.current) clearTimeout(tailTimerRef.current);
  }, []);

  return { handleTouchStart, handleTouchMove, handleTouchEnd, isPinchingRef };
}
