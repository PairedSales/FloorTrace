import React from 'react';
import { Line, Circle } from 'react-konva';

/**
 * PerimeterPlacementLayer renders temporary vertices, preview lines,
 * and instructions when the user is placing perimeter vertices.
 */
const PerimeterPlacementLayer = ({
  roomOverlay,
  traceInteractionMode,
  perimeterVertices,
  currentMousePos,
  lineToolActive,
  drawAreaActive,
  manualEntryMode,
  scale,
}) => {

  if (!roomOverlay || traceInteractionMode !== 'drawing' || !perimeterVertices || perimeterVertices.length >= 3 || lineToolActive || drawAreaActive || manualEntryMode) {
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
          stroke="#F1FA8C"
          strokeWidth={2 / scale}
          dash={[10 / scale, 5 / scale]}
          opacity={0.5}
        />
      )}
    </>
  );
};

export default React.memo(PerimeterPlacementLayer);
