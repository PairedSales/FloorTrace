import React from 'react';
import { Line } from 'react-konva';

/**
 * Draw mode's painted strokes. Rendered at the brush's full width so what the
 * user sees is the corridor the tracer will actually search, not a thin
 * centreline that under-reports the reach of their stroke.
 */
// Committed strokes are immutable — `addDrawStroke` appends by reference and
// nothing mutates one afterwards — so their flat point arrays cannot go stale.
// Without this, every mousemove past MIN_STEP rebuilt *every* committed
// stroke's array, allocating a throwaway 2-element array per point.
const flatPoints = new WeakMap();

const flatten = (stroke) => {
  if (stroke.flat) return stroke.flat; // in-progress stroke, kept flat as it grows
  const cached = flatPoints.get(stroke);
  if (cached) return cached;
  const flat = new Array(stroke.points.length * 2);
  for (let i = 0; i < stroke.points.length; i += 1) {
    flat[i * 2] = stroke.points[i].x;
    flat[i * 2 + 1] = stroke.points[i].y;
  }
  flatPoints.set(stroke, flat);
  return flat;
};

const DrawModeLayer = ({ drawStrokes, currentStroke, brushSize, visible }) => {
  if (!visible) return null;

  const strokes = currentStroke ? [...(drawStrokes ?? []), currentStroke] : (drawStrokes ?? []);
  if (!strokes.length) return null;

  return (
    <>
      {strokes.map((stroke, i) => (
        <Line
          key={`draw-stroke-${i}`}
          points={flatten(stroke)}
          stroke="#8BE9FD"
          strokeWidth={brushSize}
          lineCap="round"
          lineJoin="round"
          opacity={0.35}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
};

export default React.memo(DrawModeLayer);
