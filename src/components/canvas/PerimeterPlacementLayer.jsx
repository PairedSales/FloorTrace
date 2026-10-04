import React from 'react';
import { Line, Circle } from 'react-konva';
import { ACCENT, CRIT, PAPER } from './overlayStyle';

/**
 * PerimeterPlacementLayer renders temporary vertices, preview lines,
 * and instructions when the user is placing perimeter vertices.
 */
const PerimeterPlacementLayer = ({
  traceInteractionMode,
  perimeterVertices,
  currentMousePos,
  lineToolActive,
  drawAreaActive,
  scale,
  isPreviewInvalid = false,
}) => {

  // Placement stays visible for the whole outline: hiding it past the third
  // vertex made a hand-drawn exterior disappear exactly when it stopped being
  // a triangle. It also no longer requires a room overlay — drawing the
  // exterior by hand is a valid first move when auto-detection is not trusted.
  if (traceInteractionMode !== 'drawing' || !perimeterVertices || !perimeterVertices.length
    || lineToolActive || drawAreaActive) {
    return null;
  }

  return (
    <>
      {/* Temporary vertices */}
      {perimeterVertices.map((vertex, i) => (
        <React.Fragment key={`temp-vertex-${i}`}>
          <Circle
            x={vertex.x}
            y={vertex.y}
            radius={(i === 0 ? 7 : 5.5) / scale}
            // The first corner is the one to click again to finish.
            fill={i === 0 ? ACCENT : PAPER}
            stroke={i === 0 ? PAPER : ACCENT}
            strokeWidth={2 / scale}
          />
          
          {/* Preview line from previous vertex */}
          {i > 0 && (
            <Line
              points={[
                perimeterVertices[i - 1].x,
                perimeterVertices[i - 1].y,
                vertex.x,
                vertex.y
              ]}
              stroke={ACCENT}
              strokeWidth={2 / scale}
            />
          )}
        </React.Fragment>
      ))}
      
      {/* Preview line from last vertex to mouse */}
      {perimeterVertices.length > 0 && currentMousePos && (
        <Line
          points={[
            perimeterVertices[perimeterVertices.length - 1].x,
            perimeterVertices[perimeterVertices.length - 1].y,
            currentMousePos.x,
            currentMousePos.y
          ]}
          stroke={isPreviewInvalid ? CRIT : ACCENT}
          strokeWidth={2 / scale}
          dash={[7 / scale, 5 / scale]}
          opacity={isPreviewInvalid ? 1 : 0.7}
        />
      )}
    </>
  );
};

export default React.memo(PerimeterPlacementLayer);
