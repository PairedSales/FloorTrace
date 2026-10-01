import { useCallback, useRef, useEffect } from 'react';
import { createImageSnapAnalyzer } from '../../../utils/imageSnapper';
import { createWallSnapEngine, wallSnapEngineFromSegments } from '../../../utils/wallSnapEngine';
import { computeWallSnapSegments } from '../../../utils/detection';
import { cachedWallSnapEngine, rememberWallSnapEngine } from '../wallSnapEngineCache';

// Build the engine in the detection worker, which already holds this image
// decoded, and fall back to the main-thread builder if that fails. Building it
// on the main thread cost a full-natural-size getImageData plus a second
// data-URL decode, landing a few frames into the first gesture after every
// image change.
// Memoised across mounts, keyed by image identity, because this hook remounts
// on every plan switch — the canvas subtree is keyed on the active plan.
// Without the memo, merely switching tabs posts a wallSnapSegments request and
// rebuilds an engine the app already had, with no user action at all.
//
// The cache itself lives in a leaf module so the store can release a closed
// plan's engine without importing anything under ./canvas/.
const buildWallSnapEngine = (image) => cachedWallSnapEngine(image) ?? rememberWallSnapEngine(
  image,
  computeWallSnapSegments(image)
    .then((segments) => (segments
      ? wallSnapEngineFromSegments(segments)
      : createWallSnapEngine(image)))
    .catch(() => createWallSnapEngine(image)),
);

// One axis of a vertex, snapped onto a wall *face* rather than a centreline:
// `findSegmentSnap` lands on `faceLo`/`faceHi`, the pixel where white turns
// black. Which face is nearer decides, because a perimeter corner has no
// interior side the way a room rectangle's edges do.
//
// It wants an extent, not a point, so the axis is probed with a short span
// across the vertex. Its overlap rule is `min(edgeLen * 0.35, segLen * 0.8)`,
// so a wall that ends *at* the corner — covering only half the probe — still
// qualifies, which is exactly the case this is for.
const snapAxisToWallFace = (snapEdge, pos, spanCentre, span, tolerance) => {
  const a = spanCentre - span;
  const b = spanCentre + span;
  const lo = snapEdge(pos, a, b, tolerance, 'lo');
  const hi = snapEdge(pos, a, b, tolerance, 'hi');
  if (lo === null) return hi;
  if (hi === null) return lo;
  return Math.abs(lo - pos) <= Math.abs(hi - pos) ? lo : hi;
};

// Snapping for the one thing still placed by hand: the two ends of a known
// length. Built only while that tool is on (`enabled`), so a plan that is
// measured automatically never pays for it.
export function useSnappingSystem({ enabled, image }) {
  const imageSnapAnalyzerRef = useRef(null);
  const imageSnapAnalyzerSourceRef = useRef(null);
  const imageSnapAnalyzerLoadingRef = useRef(null);

  const wallSnapEngineRef = useRef(null);
  const wallSnapEngineSourceRef = useRef(null);
  const wallSnapEngineLoadingRef = useRef(null);

  useEffect(() => {
    imageSnapAnalyzerRef.current = null;
    imageSnapAnalyzerSourceRef.current = null;
    imageSnapAnalyzerLoadingRef.current = null;
    wallSnapEngineRef.current = null;
    wallSnapEngineSourceRef.current = null;
    wallSnapEngineLoadingRef.current = null;
  }, [image]);

  // Warm the wall engine as soon as the tool is picked up rather than on the
  // first click. Safe to do eagerly because the work is in the worker.
  useEffect(() => {
    if (!enabled || !image) return;
    let cancelled = false;
    wallSnapEngineSourceRef.current = image;
    wallSnapEngineLoadingRef.current = buildWallSnapEngine(image)
      .then((engine) => {
        if (cancelled || wallSnapEngineSourceRef.current !== image) return;
        wallSnapEngineRef.current = engine;
      })
      .catch((error) => {
        console.error('Failed to prepare wall snap engine:', error);
      })
      .finally(() => {
        if (!cancelled && wallSnapEngineSourceRef.current === image) {
          wallSnapEngineLoadingRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, image]);

  const ensureImageSnapAnalyzer = useCallback(() => {
    if (!enabled || !image) {
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
  }, [enabled, image]);

  const ensureWallSnapEngine = useCallback(() => {
    if (!enabled || !image) {
      return;
    }

    const hasCurrentEngine =
      wallSnapEngineRef.current &&
      wallSnapEngineSourceRef.current === image;
    if (hasCurrentEngine) {
      return;
    }

    const isCurrentImageLoading =
      wallSnapEngineLoadingRef.current &&
      wallSnapEngineSourceRef.current === image;
    if (isCurrentImageLoading) {
      return;
    }

    wallSnapEngineSourceRef.current = image;
    wallSnapEngineLoadingRef.current = buildWallSnapEngine(image)
      .then((engine) => {
        if (wallSnapEngineSourceRef.current !== image) {
          return;
        }
        wallSnapEngineRef.current = engine;
      })
      .catch((error) => {
        console.error('Failed to prepare wall snap engine:', error);
        if (wallSnapEngineSourceRef.current === image) {
          wallSnapEngineRef.current = null;
        }
      })
      .finally(() => {
        if (wallSnapEngineSourceRef.current === image) {
          wallSnapEngineLoadingRef.current = null;
        }
      });
  }, [enabled, image]);

  // Wall faces first, the generic dark-corner detector as the fallback. The
  // corner detector was the only thing here, and it answers a different
  // question — "is there a dark corner near this point" — so a point landed
  // on whatever ink was closest, routinely a wall centreline or a dimension
  // tick, when the length being measured runs from wall face to wall face.
  //
  // Per axis, not all-or-nothing: a corner often has a wall on one
  // side of it only, and taking the raw cursor x because the y found nothing
  // would throw away the half that was right.
  const findVertexSnapPoint = useCallback((point, tolerance = 12) => {
    if (!enabled || !point) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const corner = imageSnapAnalyzerRef.current?.findCornerSnap(point) ?? null;

    ensureWallSnapEngine();
    const engine = wallSnapEngineRef.current;
    if (!engine) {
      return corner;
    }

    const span = Math.max(6, tolerance);
    const x = snapAxisToWallFace(engine.snapVerticalEdge, point.x, point.y, span, tolerance);
    const y = snapAxisToWallFace(engine.snapHorizontalEdge, point.y, point.x, span, tolerance);

    if (x === null && y === null) {
      return corner;
    }
    return {
      x: x ?? corner?.x ?? point.x,
      y: y ?? corner?.y ?? point.y,
    };
  }, [enabled, ensureImageSnapAnalyzer, ensureWallSnapEngine]);

  return { findVertexSnapPoint };
}
