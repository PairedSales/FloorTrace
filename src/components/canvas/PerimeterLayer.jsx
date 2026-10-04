import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Line, Circle, Group } from 'react-konva';
import useAppStore from '../../store/appStore';
import { formatArea } from '../../utils/unitConverter';
import { circleHit, measureSideLenWidth, setCursor, tabSize } from './canvasUtils';
import { calculateArea, getCentroid, holeRings, holeKey, isSubtracted } from '../../utils/areaCalculator';
import { labelAnchor } from '../../utils/labelAnchor';
import { inkMapFor } from '../../utils/inkMap';
import { DEFAULT_TRACE_TYPE, normalizeTraceType } from '../../utils/traceTypes';
import {
  ACCENT, CRIT, PAPER, VEIL, lineColor, solidColor, inkColor, tintColor, withAlpha,
} from './overlayStyle';
import CanvasTab from './CanvasTab';
import OutlineSticker from './OutlineSticker';
import { stickerLayout } from './stickerLayout';
import { layoutLabels, stickerKey, cutoutKey } from './wallLabelLayout';
import { movedLabelsAt } from '../../utils/labelLayout';
import * as undoManager from '../../store/undoManager';
import { useIsTouch } from '../../hooks/useViewport';

/* ── touch ────────────────────────────────────────────────────────────────
   A vertex handle is 5 px of drawn radius. That is a fine mouse target and an
   impossible finger one — the contact patch is ~9 mm, so on a phone the corner
   the user is trying to nudge is entirely under their own fingertip.

   Two separate numbers, because they answer different questions: the drawn
   radius is "can I see which corner this is" and the hit radius is "can I
   grab it". Inflating the drawn one to 22 px would bury the outline it is
   supposed to annotate under a row of dots. */
const TOUCH_HIT_RADIUS = 22;
const LONG_PRESS_MS = 500;
// A press that wanders this far (screen px) was a drag attempt, not a hold.
const LONG_PRESS_SLOP = 10;

/** Enlarge a circular handle's hit region without touching what is drawn. */

/* ── Animation helpers ──────────────────────────────────────────────────── */

const ANIM_DURATION_MS = 75;

/** Ease-in-out cubic easing function. */
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Resample a closed polygon to exactly `n` vertices evenly distributed
 * along the perimeter by arc length.
 */
const resamplePolygon = (vertices, n) => {
  if (!vertices || vertices.length === 0 || n <= 0) return [];
  if (vertices.length === n) return vertices;

  const len = vertices.length;
  const cumLen = [0];
  for (let i = 1; i <= len; i++) {
    const a = vertices[i - 1];
    const b = vertices[i % len];
    cumLen.push(cumLen[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const totalLen = cumLen[len];
  if (totalLen === 0) return Array.from({ length: n }, () => ({ ...vertices[0] }));

  const result = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * totalLen;
    while (seg < len - 1 && cumLen[seg + 1] < target) seg++;
    const segLen = cumLen[seg + 1] - cumLen[seg];
    const t = segLen > 0 ? (target - cumLen[seg]) / segLen : 0;
    const a = vertices[seg];
    const b = vertices[(seg + 1) % len];
    result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return result;
};

/**
 * Detect whether a vertex change is a "mode toggle" (many vertices moved at
 * once) rather than a single-vertex drag or single vertex add/remove.
 */
const detectSignificantChange = (prev, next) => {
  if (!prev || !next || prev.length < 3 || next.length < 3) return false;
  
  // If the count differs by more than 1, it's a bulk change (e.g. entirely new polygon).
  if (Math.abs(prev.length - next.length) > 1) return true;
  
  // If the count differs by exactly 1, it's a single vertex add/remove.
  // We do NOT want to animate this, because animating causes all nodes to unmount
  // and remount, which produces a noticeable flash.
  if (Math.abs(prev.length - next.length) === 1) return false;

  let movedCount = 0;
  for (let i = 0; i < prev.length; i++) {
    const dx = prev[i].x - next[i].x;
    const dy = prev[i].y - next[i].y;
    if (dx * dx + dy * dy > 1) movedCount++;
    if (movedCount > 1) return true;
  }
  return false;
};

/**
 * Hook that smoothly interpolates polygon vertices when a bulk change is
 * detected (e.g. toggling between interior / exterior boundary mode).
 * Single-vertex drags are applied immediately without animation.
 *
 * Returns { displayVertices, isAnimating }.
 */
const useAnimatedVertices = (targetVertices) => {
  const [animState, setAnimState] = useState({ displayVertices: null, isAnimating: false });
  const prevVerticesRef = useRef(null);
  const currentDisplayRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    // Capture the vertices we are transitioning FROM.  If a previous
    // animation was in-flight, start from its most recent visual position
    // so that rapid toggles don't cause jumps.
    const prev = currentDisplayRef.current || prevVerticesRef.current;
    prevVerticesRef.current = targetVertices;
    currentDisplayRef.current = null;

    // Cancel any running animation.
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Nothing to animate from/to.
    if (!prev || !targetVertices || prev.length < 3 || targetVertices.length < 3) {
      setAnimState({ displayVertices: null, isAnimating: false });
      return;
    }

    // Only animate bulk polygon swaps, not single-vertex drags.
    if (!detectSignificantChange(prev, targetVertices)) {
      setAnimState({ displayVertices: null, isAnimating: false });
      return;
    }

    // Resample both polygons to the same vertex count.
    const count = Math.max(prev.length, targetVertices.length);
    const from = resamplePolygon(prev, count);
    const to = resamplePolygon(targetVertices, count);
    const startTime = performance.now();

    setAnimState({ displayVertices: from, isAnimating: true });

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / ANIM_DURATION_MS, 1);
      const eased = easeInOutCubic(progress);

      if (progress < 1) {
        const interpolated = from.map((f, i) => ({
          x: f.x + (to[i].x - f.x) * eased,
          y: f.y + (to[i].y - f.y) * eased,
        }));
        currentDisplayRef.current = interpolated;
        setAnimState({ displayVertices: interpolated, isAnimating: true });
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // End with exact target vertices.
        currentDisplayRef.current = null;
        setAnimState({ displayVertices: null, isAnimating: false });
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [targetVertices]);

  return animState;
};

/**
 * PerimeterLayer draws every visible outline's edge, the corners and wall
 * lengths of the one being edited, the cut-outs, and each outline's name and
 * area. The veil and the bands that go with them are `SpotlightLayer`'s.
 */
// How dark the plan may be under a full label before it is cut to one line.
// A room size is about 0.013 of a label's box and a stretch of wall 0.03; the
// faint end of a door swing is 0.003.
const CLEAR_ENOUGH = 0.006;
// The type size of what a cut-out takes off, in screen px.
const CUTOUT_FONT_PX = 12.5;

const PerimeterLayer = ({
  image,
  perimeterTraces,
  activeTraceId,
  scale,
  showSideLengths,
  feetPerPixel,
  calibrated = true,
  // A room is being chosen: the outlines stand back to a faint line and
  // everything that can be read or grabbed on them is put away.
  quiet = false,
  detectedDimensions,
  unit,
  draggingVertex,
  selectedVertexIndex = null,
  onVertexSelect,
  onVertexDragStart,
  onVertexDragMove,
  onVertexDragEnd,
  onDeletePerimeterVertex,
  isSelfIntersecting = false,
  voidToolActive = false,
  voidCandidate = null,
  selectedHole = null,
  onHoleSelect,
}) => {
  const activeTrace = (perimeterTraces || []).find((t) => t.id === activeTraceId);
  const targetVertices = activeTrace?.vertices;

  const isTouch = useIsTouch();
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const labelPlacements = useAppStore((s) => s.labelPlacements);
  const moveLabel = useAppStore((s) => s.moveLabel);

  /* A vertex handle is the topmost thing on the canvas and it is draggable, so
     while another drag tool is running it steals that tool's gesture: a crop
     rectangle, an erase stroke or a void that happens to start on a corner
     moves the outline instead. Read off the store rather than threaded down as
     props — `canvasRotation` above sets that precedent, and the alternative is
     five more props through CanvasStage for a fact none of the other layers
     need. The corner eraser is in the list for the same reason as the rest: its
     whole gesture is dragging *over* the handles.

     The click-to-place modes below are the same bug through the other event:
     each of them places geometry from `useToolRouter`'s stage `onClick`, and
     this handle's own `onClick` sets `cancelBubble`, so a scale-line end, a
     measurement end, a shape corner or a *replacement outline corner* dropped
     on top of an existing one is swallowed and selects that corner instead.
     Placing corners by hand is the documented rescue for a trace that came back
     wrong, and it is precisely over the wrong outline that it gets used. */
  const cropToolActive = useAppStore((s) => s.cropToolActive);
  const eraserToolActive = useAppStore((s) => s.eraserToolActive);
  const cornerEraserActive = useAppStore((s) => s.cornerEraserActive);
  const drawModeActive = useAppStore((s) => s.drawModeActive);
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const lineToolActive = useAppStore((s) => s.lineToolActive);
  const drawAreaActive = useAppStore((s) => s.drawAreaActive);
  const placingVertices = useAppStore((s) => s.traceInteractionMode === 'drawing');
  const handlesLocked = cropToolActive || eraserToolActive || cornerEraserActive
    || drawModeActive || voidToolActive
    || scaleToolActive || lineToolActive || drawAreaActive || placingVertices;
  // A crossing outline is drawn in the refusal colour for as long as the
  // corner is held there: letting go would be refused.
  const activeColor = activeTrace?.color || ACCENT;
  const activeLine = isSelfIntersecting ? CRIT : lineColor(activeColor);
  const activeSolid = isSelfIntersecting ? CRIT : solidColor(activeColor);
  const activeInk = isSelfIntersecting ? CRIT : inkColor(activeColor);
  const [hoverIndex, setHoverIndex] = useState(null);

  // Ref tracking drag coordinates, current drag index, and animation frame ID
  const draggingVertexIndexRef = useRef(null);
  const dragCoordsRef = useRef(null);
  const dragRafRef = useRef(null);

  // Local state for dragging vertices of the active trace
  const [localVertices, setLocalVertices] = useState(targetVertices);
  const [prevTargetVertices, setPrevTargetVertices] = useState(targetVertices);

  // Derived state from props synchronization, strictly guarded against active drags
  if (targetVertices !== prevTargetVertices) {
    setPrevTargetVertices(targetVertices);
    if (draggingVertexIndexRef.current === null) {
      setLocalVertices(targetVertices);
    }
  }

  // Cancel any pending RAF on unmount
  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  // ── long press ───────────────────────────────────────────────────────────
  // Right-click deletes a vertex, and touch has no right-click. A press-and-
  // hold is the touch idiom for "the other action on this thing", so it maps
  // to the same handler. Cancelled by movement (that press was a drag) and by
  // release (that press was a selection), which is what keeps it from firing
  // on the way to nudging a corner.
  const pressRef = useRef(null);

  const cancelLongPress = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const startLongPress = (index, e) => {
    const touch = e.evt?.touches?.[0];
    if (!touch) return;
    cancelLongPress();
    const origin = { x: touch.clientX, y: touch.clientY };
    pressRef.current = {
      origin,
      timer: setTimeout(() => {
        pressRef.current = null;
        // Confirmation is the deletion being undoable and the outline visibly
        // changing; a dialog on a hold gesture teaches the user to fear it.
        navigator.vibrate?.(18);
        onDeletePerimeterVertex?.(index);
      }, LONG_PRESS_MS),
    };
  };

  const moveLongPress = (e) => {
    const press = pressRef.current;
    const touch = e.evt?.touches?.[0];
    if (!press || !touch) return;
    if (Math.hypot(touch.clientX - press.origin.x, touch.clientY - press.origin.y) > LONG_PRESS_SLOP) {
      cancelLongPress();
    }
  };

  useEffect(() => cancelLongPress, []);
  // ── end long press ───────────────────────────────────────────────────────

  const handleDragStart = (index) => {
    cancelLongPress();
    draggingVertexIndexRef.current = index;
    onVertexDragStart?.(index);
  };

  const handleDragMove = (index, e) => {
    const newX = e.target.x();
    const newY = e.target.y();

    dragCoordsRef.current = { index, x: newX, y: newY };

    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        if (dragCoordsRef.current) {
          const { index: idx, x, y } = dragCoordsRef.current;
          setLocalVertices((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            next[idx] = { x, y };
            return next;
          });
          // Report the position upward so the self-intersection check can run
          // against it. Inside the rAF, not per mousemove: the parent stores
          // this in state, and the frame is already the update rate for the
          // local vertices below it.
          onVertexDragMove?.(idx, { x, y });
        }
      });
    }
  };

  const handleDragEnd = (index, e) => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    draggingVertexIndexRef.current = null;
    dragCoordsRef.current = null;
    onVertexDragEnd?.(index, e);
    // Back to the outline as the store has it. A move that is accepted arrives
    // as new vertices in the same render and replaces this; a move that is
    // refused changes nothing in the store, so nothing else would ever take
    // the dragged position back out of this layer — the bar said "the corner
    // was put back" over an outline still drawn where it was dropped, with a
    // label giving the area of a shape the plan does not have.
    setLocalVertices(targetVertices);
  };

  // Animate between bulk polygon changes (interior ↔ exterior toggle).
  const { displayVertices, isAnimating } = useAnimatedVertices(targetVertices);

  // During animation, render the interpolated path; otherwise the local/drag state.
  const renderVertices = displayVertices || localVertices;

  // Enclosed voids (courtyards, light wells, and anything punched by hand) are
  // drawn as dashed inner rings and are already subtracted from the trace's
  // area. Shapes go through the shared `holeRings` normalizer so a tagged hole
  // and a v1 file's bare ring cannot render differently.
  const holeShapes = useMemo(() => (perimeterTraces || []).flatMap((trace) => {
    if (!trace.visible) return [];
    const holes = trace.holes ?? [];
    return holeRings(holes).flatMap((ring, i) => {
      if (!ring || ring.length < 3) return [];
      const id = holeKey(holes[i], i);
      const hole = holes[i];
      // A void the outline moved out from under: still drawn, because it is the
      // user's, but in the invalid colour and no longer subtracted, so it can
      // never read as a silently-applied subtraction that is not happening.
      const stale = !!(hole && !Array.isArray(hole) && hole.stale);
      return [{
        key: `hole-${trace.id}-${id}`,
        traceId: trace.id,
        holeId: id,
        ring,
        stale,
        staleReason: stale ? hole.staleReason : null,
        points: ring.flatMap((v) => [v.x, v.y]),
        color: stale ? CRIT : lineColor(trace.color || ACCENT),
        ink: stale ? CRIT : inkColor(trace.color || ACCENT),
        selected: selectedHole?.traceId === trace.id && selectedHole?.holeId === id,
      }];
    });
  }), [perimeterTraces, selectedHole]);

  // The label is a fixed size on screen, so how much of the plan it covers
  // depends on the zoom. It is placed for the zoom rounded down to a step of an
  // eighth: within a step it stays put as the wheel turns, and the size it is
  // placed for is never smaller than the size it is drawn.
  const anchorScale = 1.125 ** Math.floor(Math.log(Math.max(scale, 1e-6)) / Math.log(1.125));
  // Upright on screen means turned in the image under a quarter turn.
  const quarterTurn = Math.abs(Math.round((canvasRotation || 0) / 90)) % 2 === 1;

  const ink = useMemo(() => inkMapFor(image), [image]);

  // Where each outline's name and area sits. From the committed outline, not
  // the one under the mouse: a label that hunted for a new spot on every frame
  // of a drag would be the thing the eye followed.
  const anchors = useMemo(() => {
    const avoid = (detectedDimensions ?? []).filter((d) => d?.bbox).map((d) => ({
      // Only a room's size was read, and its name is printed just over it.
      x: d.bbox.x - d.bbox.height,
      y: d.bbox.y - d.bbox.height * 2.2,
      width: d.bbox.width + d.bbox.height * 2,
      height: d.bbox.height * 4.2,
    }));
    const out = new Map();
    for (const t of perimeterTraces || []) {
      if (!t.visible || !t.closed || !(t.vertices?.length >= 3)) continue;
      const holes = holeRings((t.holes ?? []).filter(isSubtracted)).filter((r) => r?.length >= 3);
      // The full label, with a little air: three lines for an outline that is
      // not GLA, two for one that is.
      const counted = normalizeTraceType(t.type) === DEFAULT_TRACE_TYPE;
      const turned = (w, h) => (quarterTurn ? { width: h, height: w } : { width: w, height: h });
      const nameWidth = measureSideLenWidth(t.name ?? '', 14);
      const full = turned((Math.max(nameWidth, 92) + 40) / anchorScale, (counted ? 68 : 84) / anchorScale);
      const at = labelAnchor(t.vertices, { holes, avoid, size: full, ink });
      if (at && at.clearance >= 0 && (at.ink ?? 0) <= CLEAR_ENOUGH) {
        out.set(t.id, { ...at, roomy: true });
        continue;
      }
      // No room for all of it: the one-line label, wherever that covers least.
      const line = turned((nameWidth + (counted ? 100 : 180)) / anchorScale, 28 / anchorScale);
      out.set(t.id, {
        ...(labelAnchor(t.vertices, { holes, avoid, size: line, ink }) ?? at ?? getCentroid(t.vertices)),
        roomy: false,
      });
    }
    return out;
  }, [perimeterTraces, detectedDimensions, anchorScale, quarterTurn, ink]);

  // The corner in hand, and the two walls it moves.
  const dragging = draggingVertex !== null && draggingVertex !== undefined;
  const heldIndex = dragging ? draggingVertex : selectedVertexIndex;
  const count = renderVertices?.length ?? 0;
  const isHeldWall = (i) => heldIndex !== null && heldIndex !== undefined && count > 0
    && (i === heldIndex || i === (heldIndex - 1 + count) % count);

  // What each outline's name and area says. Worked out once, because the layout
  // of the wall lengths has to keep off the sticker as it will be drawn, and the
  // drawing has to say the same thing.
  const stickers = useMemo(() => {
    if (quiet || !feetPerPixel) return [];
    const list = [];
    for (const trace of perimeterTraces || []) {
      if (!trace.visible || !trace.closed || !trace.vertices || trace.vertices.length < 3) continue;
      const anchor = anchors.get(trace.id);
      if (!anchor) continue;

      // The outline under the mouse, so the figure follows a drag.
      const isActive = trace.id === activeTraceId;
      const vertices = isActive ? renderVertices : trace.vertices;
      if (!vertices || vertices.length < 3) continue;

      const areaOf = (ring) => {
        const { value, suffix } = formatArea(calculateArea(ring, feetPerPixel, trace.holes), unit);
        return `${value} ${suffix}`;
      };
      // No scale, no figure: the store's 1 px = 1 ft fallback is never
      // printed as square feet. Nor is an outline that crosses itself given
      // one — its lobes cancel, and the shoelace of that is not an area.
      const crossed = isActive && isSelfIntersecting;
      const areaText = calibrated && !crossed ? areaOf(vertices) : '—';
      const counted = normalizeTraceType(trace.type) === DEFAULT_TRACE_TYPE;
      const before = isActive && dragging && calibrated ? areaOf(trace.vertices) : null;
      const note = counted
        ? (before && before !== areaText ? `was ${before}` : null)
        : 'Not in GLA';
      const content = { roomy: anchor.roomy, name: trace.name, areaText, note, counted };
      const { width, height } = stickerLayout(content, 1);
      list.push({
        id: trace.id,
        x: anchor.x,
        y: anchor.y,
        width,
        height,
        content,
        color: crossed ? CRIT : (trace.color || ACCENT),
      });
    }
    return list;
  }, [quiet, feetPerPixel, perimeterTraces, anchors, activeTraceId, renderVertices, calibrated, unit, isSelfIntersecting, dragging]);

  // What each cut-out takes off the total, as a label at its middle.
  const cutouts = useMemo(() => {
    if (quiet || !feetPerPixel || !calibrated) return [];
    return holeShapes.flatMap((hole) => {
      const centre = getCentroid(hole.ring);
      const holeArea = calculateArea(hole.ring, feetPerPixel);
      if (!(holeArea > 0)) return [];
      const { value: areaText, suffix: areaSuffix } = formatArea(holeArea, unit);
      // A stale cut-out is not subtracted, so it must not claim a minus sign.
      const text = hole.stale
        ? `Cut-out outside the outline · ${areaText} ${areaSuffix}`
        : `Cut-out −${areaText} ${areaSuffix}`;
      const { width, height } = tabSize(text, CUTOUT_FONT_PX, 1);
      return [{ key: hole.key, hole, centre, text, width, height }];
    });
  }, [quiet, feetPerPixel, calibrated, holeShapes, unit]);

  // Where every label goes: all of them at once, round every outline's walls and
  // corners (`wallLabelLayout.js`). Not one wall at a time.
  const labelPlan = useMemo(() => layoutLabels({
    outlines: (perimeterTraces || [])
      .filter((t) => t.visible && t.vertices?.length >= 3)
      .map((t) => ({ id: t.id, vertices: t.vertices, holes: holeRings(t.holes ?? []) })),
    activeId: activeTrace?.visible ? activeTraceId : null,
    activeVertices: renderVertices,
    scale,
    rotation: canvasRotation,
    feetPerPixel,
    detectedDimensions,
    unit,
    wallLengths: !!showSideLengths && !quiet,
    handles: !quiet && !isAnimating,
    touch: isTouch,
    stickers,
    cutouts,
    moved: movedLabelsAt(labelPlacements, { scale, rotation: canvasRotation }),
  }), [labelPlacements, perimeterTraces, activeTrace, activeTraceId, renderVertices, scale, canvasRotation, feetPerPixel,
    detectedDimensions, unit, showSideLengths, quiet, isAnimating, isTouch, stickers, cutouts]);

  // A label let go somewhere else stays there until the zoom changes. One undo
  // point per drag, saved before the move like every other edit.
  const placeLabel = (key, at, sig) => {
    undoManager.save();
    moveLabel(key, sig ? { ...at, sig } : at, { scale, rotation: canvasRotation });
  };
  const onMovedFor = (key, sig) => (handlesLocked ? undefined : (at) => placeLabel(key, at, sig));

  // What a drag shows besides the outline itself: where the corner was, and
  // whether it now sits square to the walls either side of it.
  const dragMarks = (() => {
    if (!dragging || !localVertices || !targetVertices || count < 3 || isAnimating) return null;
    const was = targetVertices[draggingVertex];
    const now = localVertices[draggingVertex];
    const prev = localVertices[(draggingVertex - 1 + count) % count];
    const next = localVertices[(draggingVertex + 1) % count];
    if (!was || !now || !prev || !next) return null;
    const toPrev = { x: prev.x - now.x, y: prev.y - now.y };
    const toNext = { x: next.x - now.x, y: next.y - now.y };
    const lenPrev = Math.hypot(toPrev.x, toPrev.y);
    const lenNext = Math.hypot(toNext.x, toNext.y);
    if (!(lenPrev > 0) || !(lenNext > 0)) return null;
    const u = { x: toPrev.x / lenPrev, y: toPrev.y / lenPrev };
    const v = { x: toNext.x / lenNext, y: toNext.y / lenNext };
    // Within about a degree of a right angle.
    const square = Math.abs(u.x * v.x + u.y * v.y) < 0.02;
    const reach = 40 / scale;
    const tick = 12 / scale;
    return {
      moved: Math.hypot(now.x - was.x, now.y - was.y) > 0.5 / scale,
      ghost: [prev.x, prev.y, was.x, was.y, next.x, next.y],
      was,
      square,
      guides: [
        [prev.x + u.x * reach, prev.y + u.y * reach, now.x - u.x * reach, now.y - u.y * reach],
        [next.x + v.x * reach, next.y + v.y * reach, now.x - v.x * reach, now.y - v.y * reach],
      ],
      corner: [
        now.x + u.x * tick, now.y + u.y * tick,
        now.x + (u.x + v.x) * tick, now.y + (u.y + v.y) * tick,
        now.x + v.x * tick, now.y + v.y * tick,
      ],
    };
  })();

  return (
    <>
      {/* 1. The outlines that are not being edited: a line on the wall's edge.
             The band over the wall and the veil round them are SpotlightLayer's,
             under this layer. */}
      {(perimeterTraces || []).map((trace) => {
        if (!trace.visible || trace.id === activeTraceId) return null;
        return (
          <Line
            key={`inactive-outline-${trace.id}`}
            points={trace.vertices ? trace.vertices.flatMap(v => [v.x, v.y]) : []}
            stroke={lineColor(trace.color || ACCENT)}
            strokeWidth={1.5 / scale}
            opacity={quiet ? 0.6 : 1}
            closed={true}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}

      {/* 2. The outline being edited */}
      {activeTrace && activeTrace.visible && (
        <Line
          key={`active-outline-${activeTrace.id}`}
          points={renderVertices ? renderVertices.flatMap(v => [v.x, v.y]) : []}
          stroke={activeLine}
          strokeWidth={(isSelfIntersecting ? 2.5 : 1.75) / scale}
          opacity={quiet ? 0.6 : 1}
          closed={true}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {/* 2b. Cut-outs: a dashed edge. One that is taken off is back under the
              veil, which is what says so; one the outline has moved out from
              under is still drawn, because it is the user's, but in the colour
              of a thing that is not being applied. */}
      {holeShapes.map((hole) => (
        <Line
          key={hole.key}
          name="void-hole"
          points={hole.points}
          stroke={hole.color}
          strokeWidth={(hole.selected ? 3.5 : 2) / scale}
          dash={[7 / scale, 5 / scale]}
          opacity={quiet ? 0.6 : 1}
          closed={true}
          // Nothing to see, but a shape with no fill is only its stroke to a
          // click, and a cut-out is picked by clicking inside it.
          fill={voidToolActive ? 'rgba(0, 0, 0, 0.001)' : undefined}
          listening={voidToolActive}
          onClick={voidToolActive ? (e) => {
            e.cancelBubble = true;
            onHoleSelect?.({ traceId: hole.traceId, holeId: hole.holeId });
          } : undefined}
          onTap={voidToolActive ? (e) => {
            e.cancelBubble = true;
            onHoleSelect?.({ traceId: hole.traceId, holeId: hole.holeId });
          } : undefined}
          perfectDrawEnabled={false}
        />
      ))}

      {/* 2c. What each cut-out takes off the total. The outline's label shows
              the net area, which on its own never accounts for the difference. */}
      {cutouts.map(({ key, hole, text, width, height }) => {
        const at = labelPlan.cutouts.get(key) ?? getCentroid(hole.ring);
        return (
          <CanvasTab
            key={`void-label-${key}`}
            x={at.x}
            y={at.y}
            width={width / scale}
            height={height / scale}
            text={text}
            fontSize={CUTOUT_FONT_PX / scale}
            scale={scale}
            rotation={canvasRotation}
            color={hole.ink}
            edge={hole.stale ? CRIT : tintColor(hole.color)}
            onMoved={onMovedFor(cutoutKey(key))}
          />
        );
      })}

      {/* 2d. The cut-out being drawn, in the refusal colour when the candidate
              already fails validation — so the rejection is visible before the
              mouse comes up. */}
      {voidCandidate?.ring?.length >= 2 && (
        <>
          <Line
            points={voidCandidate.ring.flatMap((v) => [v.x, v.y])}
            stroke={voidCandidate.valid ? activeLine : CRIT}
            strokeWidth={2 / scale}
            dash={[7 / scale, 5 / scale]}
            closed={voidCandidate.ring.length >= 3}
            fill={voidCandidate.ring.length >= 3
              ? withAlpha(voidCandidate.valid ? VEIL.color : CRIT, voidCandidate.valid ? VEIL.opacity : 0.12)
              : undefined}
            listening={false}
            perfectDrawEnabled={false}
          />
          {!voidCandidate.closed && voidCandidate.ring.map((v, i) => (
            <Circle
              key={`void-corner-${i}`}
              x={v.x}
              y={v.y}
              radius={4 / scale}
              fill={PAPER}
              stroke={voidCandidate.valid ? activeLine : CRIT}
              strokeWidth={2 / scale}
              listening={false}
              perfectDrawEnabled={false}
            />
          ))}
        </>
      )}

      {/* 3. A corner being moved: where it was, and a square mark with the two
             walls run on past it once they meet at a right angle. */}
      {dragMarks && activeTrace?.visible && !isSelfIntersecting && (
        <Group listening={false}>
          {dragMarks.square && dragMarks.guides.map((points, i) => (
            <Line
              key={`guide-${i}`}
              points={points}
              stroke={activeLine}
              strokeWidth={1 / scale}
              dash={[2 / scale, 4 / scale]}
              perfectDrawEnabled={false}
            />
          ))}
          {dragMarks.moved && (
            <>
              <Line
                points={dragMarks.ghost}
                stroke={activeLine}
                strokeWidth={1.5 / scale}
                dash={[5 / scale, 4 / scale]}
                opacity={0.6}
                perfectDrawEnabled={false}
              />
              <Circle
                x={dragMarks.was.x}
                y={dragMarks.was.y}
                radius={4 / scale}
                fill={PAPER}
                stroke={activeLine}
                strokeWidth={1.5 / scale}
                opacity={0.6}
                perfectDrawEnabled={false}
              />
            </>
          )}
          {dragMarks.square && (
            <Line
              points={dragMarks.corner}
              stroke={activeLine}
              strokeWidth={1.5 / scale}
              perfectDrawEnabled={false}
            />
          )}
        </Group>
      )}

      {/* 4. The halo under the corner the pointer is on, has picked, or is moving */}
      {activeTrace && activeTrace.visible && !quiet && !isAnimating && localVertices && (() => {
        const index = dragging ? draggingVertex : (selectedVertexIndex ?? hoverIndex);
        const vertex = index !== null && index !== undefined ? localVertices[index] : null;
        if (!vertex || handlesLocked) return null;
        const held = dragging || selectedVertexIndex === index;
        return (
          <Circle
            x={vertex.x}
            y={vertex.y}
            radius={(dragging ? 22 : held ? 17 : 15) / scale}
            fill={withAlpha(activeSolid, held ? 0.16 : 0.12)}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })()}

      {/* 5. The corners: rings, so the wall corner under each one shows through */}
      {activeTrace && activeTrace.visible && !quiet && !isAnimating && localVertices && localVertices.map((vertex, i) => {
        const moving = dragging && draggingVertex === i;
        // One corner is in hand at a time: a corner picked earlier is not the
        // one being moved now.
        const picked = !dragging && selectedVertexIndex === i;
        const over = hoverIndex === i && !handlesLocked;
        const held = moving || picked;
        // While one corner moves the rest stand down, bar the two it shares a
        // wall with: they are what the moving walls are anchored to.
        const neighbour = dragging && (i === (draggingVertex - 1 + count) % count || i === (draggingVertex + 1) % count);
        const radius = (moving ? 10 : picked ? 9 : over ? 8 : 6) + (isTouch ? 2.5 : 0);
        return (
          <Circle
            key={`active-vertex-${activeTrace.id}-${i}`}
            x={vertex.x}
            y={vertex.y}
            radius={radius / scale}
            fill={held ? activeSolid : (over ? PAPER : 'rgba(255, 255, 255, 0.85)')}
            stroke={held ? PAPER : activeLine}
            strokeWidth={(held || over ? 2.5 : 2) / scale}
            visible={!dragging || moving || neighbour}
            draggable={!handlesLocked}
            // Both, not just `draggable`: a non-draggable handle still swallows
            // the press, so the crop or erase stroke would start nowhere at all.
            listening={!handlesLocked}
            // The grabbable region, separate from the drawn one. `/scale` keeps
            // it a constant *screen* size, so a corner is no harder to hit when
            // the plan is zoomed out — which is exactly when it is smallest.
            hitFunc={isTouch ? circleHit(TOUCH_HIT_RADIUS / scale) : undefined}
            onMouseEnter={(e) => { setHoverIndex(i); setCursor(e, 'grab'); }}
            onMouseLeave={(e) => { setHoverIndex((h) => (h === i ? null : h)); setCursor(e, 'default'); }}
            onClick={(e) => {
              // Konva fires click for every button, and right-click already means
              // delete on this handle.
              if (e.evt && e.evt.button != null && e.evt.button !== 0) return;
              e.cancelBubble = true;
              onVertexSelect?.(i);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onVertexSelect?.(i);
            }}
            onDragStart={() => handleDragStart(i)}
            onDragMove={(e) => handleDragMove(i, e)}
            onDragEnd={(e) => handleDragEnd(i, e)}
            // Deliberately allowed to bubble, matching what `mousedown` does on
            // the same handle: the stage still needs the event to start a pinch
            // whose first finger happened to land on a corner.
            onTouchStart={(e) => startLongPress(i, e)}
            onTouchMove={moveLongPress}
            onTouchEnd={cancelLongPress}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              if (onDeletePerimeterVertex) onDeletePerimeterVertex(i);
            }}
          />
        );
      })}

      {/* 6. Wall lengths, outside the walls. The two the held corner moves are
             filled; while it moves, the rest stand back. */}
      {activeTrace && activeTrace.visible && !quiet && labelPlan.walls.map((layout, i) => layout && (
        <CanvasTab
          key={`active-label-${activeTrace.id}-${i}`}
          x={layout.finalCx}
          y={layout.finalCy}
          width={layout.labelWidth}
          height={layout.labelHeight}
          text={layout.formattedLength}
          fontSize={layout.fontSize}
          scale={scale}
          rotation={canvasRotation}
          color={isHeldWall(i) ? activeSolid : activeInk}
          edge={tintColor(activeSolid)}
          solid={isHeldWall(i)}
          opacity={dragging && !isHeldWall(i) ? 0.45 : 1}
          onMoved={dragging ? undefined : onMovedFor(layout.key, layout.sig)}
        />
      ))}

      {/* 7. Each outline's name and area. Always, not only when there are
             several: a lone outline's label is where the eye checks the figure
             the panel leads with against the shape it came from. */}
      {stickers.map((sticker) => {
        const at = labelPlan.stickers.get(sticker.id) ?? sticker;
        return (
          <OutlineSticker
            key={`sticker-${sticker.id}`}
            x={at.x}
            y={at.y}
            {...sticker.content}
            color={sticker.color}
            scale={scale}
            rotation={canvasRotation}
            onMoved={dragging ? undefined : onMovedFor(stickerKey(sticker.id))}
          />
        );
      })}
    </>
  );
};

export default React.memo(PerimeterLayer);
