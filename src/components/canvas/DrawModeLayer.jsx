import React from 'react';
import { Line } from 'react-konva';

/**
 * Draw mode's painted strokes. Rendered at the brush's full width so what the
 * user sees is the corridor the tracer will actually search, not a thin
 * centreline that under-reports the reach of their stroke.
 */
const DrawModeLayer = ({ drawStrokes, currentStroke, brushSize, visible }) => {
  if (!visible) return null;

  const strokes = currentStroke ? [...(drawStrokes ?? []), currentStroke] : (drawStrokes ?? []);
  if (!strokes.length) return null;

  return (
    <>
      {strokes.map((stroke, i) => (
        <Line
          key={`draw-stroke-${i}`}
          points={stroke.points.flatMap((p) => [p.x, p.y])}
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
