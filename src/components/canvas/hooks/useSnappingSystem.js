import { useCallback, useRef, useEffect } from 'react';
import { createImageSnapAnalyzer } from '../../../utils/imageSnapper';

export function useSnappingSystem({ autoSnapEnabled, image, factor }) {
  const imageSnapAnalyzerRef = useRef(null);
  const imageSnapAnalyzerSourceRef = useRef(null);
  const imageSnapAnalyzerLoadingRef = useRef(null);

  useEffect(() => {
    imageSnapAnalyzerRef.current = null;
    imageSnapAnalyzerSourceRef.current = null;
    imageSnapAnalyzerLoadingRef.current = null;
  }, [image]);

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

  const findVerticalSnap = useCallback((targetX, y1, y2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findVerticalWall(targetX, y1, y2, { searchRadius });
  }, [autoSnapEnabled, ensureImageSnapAnalyzer]);

  const findHorizontalSnap = useCallback((targetY, x1, x2, searchRadius = 15) => {
    if (!autoSnapEnabled) {
      return null;
    }

    ensureImageSnapAnalyzer();
    const analyzer = imageSnapAnalyzerRef.current;
    if (!analyzer) {
      return null;
    }

    return analyzer.findHorizontalWall(targetY, x1, x2, { searchRadius });
  }, [autoSnapEnabled, ensureImageSnapAnalyzer]);

  const snapRoomOverlayPosition = useCallback((overlay) => {
    const width = overlay.x2 - overlay.x1;
    const height = overlay.y2 - overlay.y1;

    const leftSnap = findVerticalSnap(overlay.x1, overlay.y1, overlay.y2);
    const rightSnap = findVerticalSnap(overlay.x2, overlay.y1, overlay.y2);
    const topSnap = findHorizontalSnap(overlay.y1, overlay.x1, overlay.x2);
    const bottomSnap = findHorizontalSnap(overlay.y2, overlay.x1, overlay.x2);

    const snapDeltaX = [
      leftSnap !== null ? leftSnap - overlay.x1 : null,
      rightSnap !== null ? rightSnap - overlay.x2 : null,
    ].filter((value) => value !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    const snapDeltaY = [
      topSnap !== null ? topSnap - overlay.y1 : null,
      bottomSnap !== null ? bottomSnap - overlay.y2 : null,
    ].filter((value) => value !== null).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;

    const result = {
      x1: overlay.x1 + snapDeltaX,
      y1: overlay.y1 + snapDeltaY,
      x2: overlay.x1 + snapDeltaX + width,
      y2: overlay.y1 + snapDeltaY + height,
    };

    if (Array.isArray(overlay.polygon)) {
      result.polygon = overlay.polygon.map(p => ({
        x: p.x + snapDeltaX,
        y: p.y + snapDeltaY,
      }));
    }
    if (overlay.confidence !== undefined) {
      result.confidence = overlay.confidence;
    }

    return result;
  }, [findHorizontalSnap, findVerticalSnap]);

  return {
    findVertexSnapPoint,
    findVerticalSnap,
    findHorizontalSnap,
    snapRoomOverlayPosition,
    ensureImageSnapAnalyzer,
  };
}
