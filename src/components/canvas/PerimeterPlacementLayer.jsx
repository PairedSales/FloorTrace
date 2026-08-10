import React from 'react';
import { Line, Circle } from 'react-konva';

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
  manualEntryMode,
  scale,
  isPreviewInvalid = false,
}) => {

  // Placement stays visible for the whole outline: hiding it past the third
  // vertex made a hand-drawn exterior disappear exactly when it stopped being
  // a triangle. It also no longer requires a room overlay — drawing the
  // exterior by hand is a valid first move when auto-detection is not trusted.
  if (traceInteractionMode !== 'drawing' || !perimeterVertices || !perimeterVertices.length
    || lineToolActive || drawAreaActive || manualEntryMode) {
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
            radius={5 / scale}
            fill="#F1FA8C"
            stroke="#fff"
            strokeWidth={1.5 / scale}
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
              stroke="#F1FA8C"
              strokeWidth={2 / scale}
              dash={[10 / scale, 5 / scale]}
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
          stroke={isPreviewInvalid ? '#FF5555' : '#F1FA8C'}
          strokeWidth={2 / scale}
          dash={[10 / scale, 5 / scale]}
          opacity={isPreviewInvalid ? 0.8 : 0.5}
        />
      )}
    </>
  );
};

export default React.memo(PerimeterPlacementLayer);
