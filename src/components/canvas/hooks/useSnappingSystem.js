import { useCallback, useRef, useEffect } from 'react';
import { createImageSnapAnalyzer } from '../../../utils/imageSnapper';
import { createWallSnapEngine, wallSnapEngineFromSegments } from '../../../utils/wallSnapEngine';
import { computeWallSnapSegments } from '../../../utils/detection';

// Build the engine in the detection worker, which already holds this image
// decoded, and fall back to the main-thread builder if that fails. Building it
// on the main thread cost a full-natural-size getImageData plus a second
// data-URL decode, landing a few frames into the first gesture after every
// image change (and `image` changes on every crop, so this is not once per
// session).
// Memoised across mounts, keyed by image identity, because this hook now
// remounts on every plan switch — the canvas subtree is keyed on the active
// plan. Without the memo, `autoSnapEnabled` defaulting to true means merely
// switching tabs posts a `wallSnapSegments` request and rebuilds an engine the
// app already had, with no user action at all.
//
// Two entries, matching the worker's decode cache: alternating between two
// plans is the case worth being free, and an engine holds vectorised segments
// for a whole page.
const MAX_ENGINES = 2;
/** @type {Map<string, Promise<object>>} data URL → engine */
const engines = new Map();

const buildWallSnapEngine = (image) => {
  const hit = engines.get(image);
  if (hit) {
    engines.delete(image);
    engines.set(image, hit);
    return hit;
  }

  const task = computeWallSnapSegments(image)
    .then((segments) => (segments
      ? wallSnapEngineFromSegments(segments)
      : createWallSnapEngine(image)))
    .catch(() => createWallSnapEngine(image));

  engines.set(image, task);
  while (engines.size > MAX_ENGINES) engines.delete(engines.keys().next().value);
  return task;
};

/** Forget a plan's engine. Called when its image is gone for good. */
export const forgetWallSnapEngine = (image) => {
  engines.delete(image);
};

export function useSnappingSystem({ autoSnapEnabled, image }) {
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

  // Warm the wall engine as soon as the image changes rather than on the first
  // gesture. Safe to do eagerly only because the work is now in the worker —
  // on the main thread this was the 12-60 ms stall it replaces.
  //
  // This is the one part of the change a user could notice: `handleStageMouseUp`
  // commits the overlay from the last mousemove without re-snapping, so a quick
  // flick that ended before the engine was ready used to commit an *unsnapped*
  // rect, and now commits a snapped one. That is what auto-snap promises, and
  // the rect feeds the implied px/ft, so it is a change worth stating.
  useEffect(() => {
    if (!autoSnapEnabled || !image) return;
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
  }, [autoSnapEnabled, image]);

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

  const ensureWallSnapEngine = useCallback(() => {
    if (!autoSnapEnabled || !image) {
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

  // Translate the whole overlay by the smallest delta that lands one vertical
  // and/or one horizontal edge on a wall face. Each edge targets the face on
  // the room-interior side: the left edge lands on a wall's right face, the
  // top edge on a wall's bottom face, and so on.
  const snapRoomOverlayMove = useCallback((overlay, tolerance = 12) => {
    if (!autoSnapEnabled) {
      return overlay;
    }

    ensureWallSnapEngine();
    const engine = wallSnapEngineRef.current;
    if (!engine) {
      return overlay;
    }

    const left = engine.snapVerticalEdge(overlay.x1, overlay.y1, overlay.y2, tolerance, 'hi');
    const right = engine.snapVerticalEdge(overlay.x2, overlay.y1, overlay.y2, tolerance, 'lo');
    const top = engine.snapHorizontalEdge(overlay.y1, overlay.x1, overlay.x2, tolerance, 'hi');
    const bottom = engine.snapHorizontalEdge(overlay.y2, overlay.x1, overlay.x2, tolerance, 'lo');

    const dx = [
      left !== null ? left - overlay.x1 : null,
      right !== null ? right - overlay.x2 : null,
    ].filter((v) => v !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    const dy = [
      top !== null ? top - overlay.y1 : null,
      bottom !== null ? bottom - overlay.y2 : null,
    ].filter((v) => v !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    if (dx === 0 && dy === 0) {
      return overlay;
    }

    const result = {
      x1: overlay.x1 + dx,
      y1: overlay.y1 + dy,
      x2: overlay.x2 + dx,
      y2: overlay.y2 + dy,
    };
    if (Array.isArray(overlay.polygon)) {
      result.polygon = overlay.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    if (overlay.confidence !== undefined) {
      result.confidence = overlay.confidence;
    }
    return result;
  }, [autoSnapEnabled, ensureWallSnapEngine]);

  // Snap only the two edges being dragged by the given corner handle.
  const snapRoomOverlayResize = useCallback((corner, rect, tolerance = 12) => {
    if (!autoSnapEnabled) {
      return rect;
    }

    ensureWallSnapEngine();
    const engine = wallSnapEngineRef.current;
    if (!engine) {
      return rect;
    }

    const movesX1 = corner === 'tl' || corner === 'bl';
    const movesY1 = corner === 'tl' || corner === 'tr';
    const edgeX = movesX1 ? rect.x1 : rect.x2;
    const edgeY = movesY1 ? rect.y1 : rect.y2;

    const snappedX = engine.snapVerticalEdge(edgeX, rect.y1, rect.y2, tolerance, movesX1 ? 'hi' : 'lo');
    const snappedY = engine.snapHorizontalEdge(edgeY, rect.x1, rect.x2, tolerance, movesY1 ? 'hi' : 'lo');

    const result = { ...rect };
    if (snappedX !== null) {
      result[movesX1 ? 'x1' : 'x2'] = snappedX;
    }
    if (snappedY !== null) {
      result[movesY1 ? 'y1' : 'y2'] = snappedY;
    }
    return result;
  }, [autoSnapEnabled, ensureWallSnapEngine]);

  return {
    findVertexSnapPoint,
    snapRoomOverlayMove,
    snapRoomOverlayResize,
    ensureImageSnapAnalyzer,
    ensureWallSnapEngine,
  };
}
