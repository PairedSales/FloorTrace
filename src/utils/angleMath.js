/**
 * Math and snapping utilities for the Interactive Protractor / Angle Measurement Tool.
 */

/**
 * Calculates derived endpoint coordinates from center, angle, and radius.
 */
export function getDerivedEndpoints(center, angle1, angle2, radius1, radius2) {
  return {
    p1: {
      x: center.x + Math.cos(angle1) * radius1,
      y: center.y + Math.sin(angle1) * radius1,
    },
    p2: {
      x: center.x + Math.cos(angle2) * radius2,
      y: center.y + Math.sin(angle2) * radius2,
    },
  };
}

/**
 * Computes layout information for the angle sweep arc and text label,
 * keeping the sweep within the smaller interior angle (<= 180 degrees).
 */
export function getAngleLayout(center, angle1, angle2, radius1, radius2, arcRadiusScreen, scale) {
  let diff = angle2 - angle1;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  while (diff > Math.PI) diff -= 2 * Math.PI;

  const startAngle = diff >= 0 ? angle1 : angle2;
  const sweepAngle = Math.abs(diff);
  const angleDeg = sweepAngle * 180 / Math.PI;

  // Arc radius in local canvas units
  const arcRadiusLocal = arcRadiusScreen / scale;

  // Bisector angle
  const bisectRad = startAngle + sweepAngle / 2;

  // Label offset (slightly outside the arc)
  const labelOffsetLocal = arcRadiusLocal + 20 / scale; // 20px screen offset
  const labelX = center.x + Math.cos(bisectRad) * labelOffsetLocal;
  const labelY = center.y + Math.sin(bisectRad) * labelOffsetLocal;

  // Calculate arc rendered pixel length to determine if it should be hidden
  const pixelArcLength = sweepAngle * arcRadiusScreen;
  const hideArc = pixelArcLength < 3;

  // Suppress arc for straight angles (~180 deg)
  const isStraight = Math.abs(sweepAngle - Math.PI) < 0.005;

  return {
    startAngle,
    sweepAngle,
    angleDeg,
    arcRadiusLocal,
    bisectRad,
    labelX,
    labelY,
    hideArc,
    isStraight,
  };
}

/**
 * Snaps a local cursor position to geometry vertices (perimeter, shapes, lines)
 * or OCR walls. Performs all snap-distance threshold checks in screen space
 * using absolute transforms to avoid scale/rotation assumptions.
 */
export function findAngleSnapPointScreen(
  localCursorPoint,
  stage,
  contentLayer,
  perimeterTraces,
  customShapes,
  measurementLines,
  autoSnapEnabled,
  findVertexSnapPoint
) {
  if (!autoSnapEnabled || !stage || !contentLayer) {
    return null;
  }

  const transform = contentLayer.getAbsoluteTransform();
  const mouseScreen = transform.point(localCursorPoint);

  // Snapping tolerance is 15 pixels on screen
  const snapToleranceScreen = 15;
  const snapToleranceScreenSq = snapToleranceScreen * snapToleranceScreen;

  let bestLocalPoint = null;
  let minDistanceScreenSq = snapToleranceScreenSq;

  const checkLocalPoint = (p) => {
    if (!p) return;
    const screenPt = transform.point(p);
    const dx = screenPt.x - mouseScreen.x;
    const dy = screenPt.y - mouseScreen.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistanceScreenSq) {
      minDistanceScreenSq = distSq;
      bestLocalPoint = p;
    }
  };

  // 1. Check perimeter vertices of visible traces
  if (perimeterTraces) {
    perimeterTraces.forEach((trace) => {
      if (trace.visible && trace.vertices) {
        trace.vertices.forEach(checkLocalPoint);
      }
    });
  }

  // 2. Check custom shapes vertices
  if (customShapes) {
    customShapes.forEach((shape) => {
      if (shape.vertices) {
        shape.vertices.forEach(checkLocalPoint);
      }
    });
  }

  // 3. Check measurement lines endpoints
  if (measurementLines) {
    measurementLines.forEach((line) => {
      checkLocalPoint(line.start);
      checkLocalPoint(line.end);
    });
  }

  if (bestLocalPoint) {
    return bestLocalPoint;
  }

  // 4. Fallback to image-snapping (OCR corners)
  if (findVertexSnapPoint) {
    const wallSnapLocal = findVertexSnapPoint(localCursorPoint);
    if (wallSnapLocal) {
      // Check snap tolerance on screen for wallSnapLocal
      const wallSnapScreen = transform.point(wallSnapLocal);
      const dx = wallSnapScreen.x - mouseScreen.x;
      const dy = wallSnapScreen.y - mouseScreen.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < snapToleranceScreenSq) {
        return wallSnapLocal;
      }
    }
  }

  return null;
}

/**
 * Finds the neighboring vertices of a snapped point in the active geometries.
 */
export function findVertexNeighbors(snappedPoint, perimeterTraces, customShapes, measurementLines) {
  if (!snappedPoint) return null;
  const eps = 1e-4;
  const isClose = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2) < eps;

  // 1. Check perimeter vertices of visible traces
  if (perimeterTraces) {
    for (const trace of perimeterTraces) {
      if (trace.visible && trace.vertices) {
        const vertices = trace.vertices;
        const L = vertices.length;
        for (let i = 0; i < L; i++) {
          if (isClose(vertices[i], snappedPoint)) {
            const n1 = vertices[(i - 1 + L) % L];
            const n2 = vertices[(i + 1) % L];
            return [n1, n2];
          }
        }
      }
    }
  }

  // 2. Check custom shapes
  if (customShapes) {
    for (const shape of customShapes) {
      if (shape.vertices) {
        const vertices = shape.vertices;
        const L = vertices.length;
        for (let i = 0; i < L; i++) {
          if (isClose(vertices[i], snappedPoint)) {
            if (shape.closed) {
              const n1 = vertices[(i - 1 + L) % L];
              const n2 = vertices[(i + 1) % L];
              return [n1, n2];
            } else {
              const neighbors = [];
              if (i > 0) neighbors.push(vertices[i - 1]);
              if (i < L - 1) neighbors.push(vertices[i + 1]);
              return neighbors;
            }
          }
        }
      }
    }
  }

  // 3. Check measurement lines
  if (measurementLines) {
    for (const line of measurementLines) {
      if (isClose(line.start, snappedPoint)) {
        return [line.end];
      }
      if (isClose(line.end, snappedPoint)) {
        return [line.start];
      }
    }
  }

  return null;
}

